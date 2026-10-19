use std::collections::BTreeSet;

use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use uuid::Uuid;

use super::{phone, repository, types::*};
use crate::{error::AppError, features::invoices, state::AppState};

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
static RENDER_SLOTS: Semaphore = Semaphore::const_new(2);

pub(crate) fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(crate) struct Source {
    pub snapshot: Snapshot,
    pub html: String,
    pub artifact_hash: String,
    pub recipients: Vec<Destination>,
    pub generation: i64,
}

pub(crate) async fn source(
    state: &AppState,
    invoice_id: Uuid,
    kind: &str,
) -> Result<Source, AppError> {
    if ![
        "invoice_created",
        "invoice_updated",
        "invoice_ready",
        "manual_resend",
    ]
    .contains(&kind)
    {
        return Err(AppError::BadRequest("Unknown notification kind.".into()));
    }
    let (revision, generation) = repository::revision(state.db(), invoice_id).await?;
    let detail = invoices::service::get_invoice(state, invoice_id).await?;
    if kind == "invoice_ready" && detail.readiness.readiness_status != "ready" {
        return Err(AppError::Conflict(
            "This invoice is not ready for pickup. Refresh its orders first.".into(),
        ));
    }
    let customers = repository::customers(state.db(), invoice_id).await?;
    let config = state.notifications();
    let (recipients, exclusions) = phone::destinations(customers.clone(), &config.default_region);
    let html = invoices::document::render_snapshot(state, &detail).await?;
    let reference = format!("INV-{}", detail.invoice_number);
    let balance = format!(
        "{} BHD",
        crate::document::format_amount(detail.totals.balance_due)
    );
    let (template_name, body_template, parameters) = if kind == "invoice_ready" {
        (
            &config.ready_template,
            &config.ready_body,
            vec![
                reference,
                detail
                    .branch_name
                    .clone()
                    .ok_or_else(|| AppError::BadRequest("Choose a pickup branch first.".into()))?,
                balance,
            ],
        )
    } else {
        (
            &config.invoice_template,
            &config.invoice_body,
            vec![
                reference,
                state.invoice_branding().name_en.clone(),
                format!(
                    "{} BHD",
                    crate::document::format_amount(detail.totals.total)
                ),
                balance,
            ],
        )
    };
    let mut body = body_template.clone();
    for (index, value) in parameters.iter().enumerate() {
        body = body.replace(&format!("{{{{{}}}}}", index + 1), value);
    }
    if body.contains("{{") {
        return Err(AppError::Unavailable(
            "The WhatsApp template contains an unconfigured parameter.".into(),
        ));
    }
    let source_hash = hash(&serde_json::to_vec(&json!({"detail":detail,"html":html,"customers":customers,"revision":revision,"kind":if kind == "invoice_ready" { "ready" } else { "document" },"template":template_name,"body":body_template,"language":config.language,"profile":config.renderer_profile})).map_err(|e| AppError::Config(e.to_string()))?);
    let artifact_hash = hash(format!("{}\n{}", config.renderer_profile, html).as_bytes());
    if repository::revision(state.db(), invoice_id).await?.0 != revision {
        return Err(AppError::Conflict(
            "The invoice changed while preparing the preview. Please refresh.".into(),
        ));
    }
    Ok(Source {
        snapshot: Snapshot {
            invoice_number: detail.invoice_number,
            source_hash,
            revision,
            body,
            template_name: template_name.clone(),
            language: config.language.clone(),
            parameters,
            exclusions,
        },
        html,
        artifact_hash,
        recipients,
        generation,
    })
}

pub(crate) fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::External(e.to_string()))
}

pub(crate) async fn artifact(
    state: &AppState,
    invoice_id: Uuid,
    source: &Source,
) -> Result<Uuid, AppError> {
    if let Some(id) = repository::artifact_id(state.db(), invoice_id, &source.artifact_hash).await?
    {
        return Ok(id);
    }
    let url = state.notifications().renderer_url.as_deref().ok_or_else(|| AppError::Unavailable("PDF rendering is not configured. The invoice is saved; try the notification again after the renderer is available.".into()))?;
    let _permit = RENDER_SLOTS
        .acquire()
        .await
        .map_err(|e| AppError::Unavailable(e.to_string()))?;
    let part = reqwest::multipart::Part::text(source.html.clone())
        .file_name("index.html")
        .mime_str("text/html")
        .map_err(|e| AppError::External(e.to_string()))?;
    let form = reqwest::multipart::Form::new().part("files", part)
        .text("preferCssPageSize","true").text("printBackground","true")
        .text("waitForExpression", "(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(img => img.decode())); return true; })()");
    let mut response = http_client()?.post(format!("{}/forms/chromium/convert/html",url.trim_end_matches('/'))).multipart(form).send().await
        .map_err(|_| AppError::External("The PDF renderer could not be reached. Your invoice is saved; try preparing the preview again.".into()))?;
    if !response.status().is_success() {
        return Err(AppError::External(format!(
            "PDF rendering failed ({}). The invoice is saved.",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PDF_BYTES as u64)
    {
        return Err(AppError::BadRequest(
            "The invoice PDF exceeds 20 MB.".into(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::External("The PDF response was interrupted.".into()))?
    {
        if bytes.len() + chunk.len() > MAX_PDF_BYTES {
            return Err(AppError::BadRequest(
                "The invoice PDF exceeds 20 MB.".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(AppError::External(
            "The renderer did not return a PDF.".into(),
        ));
    }
    repository::store_artifact(
        state.db(),
        invoice_id,
        &source.artifact_hash,
        &format!("INV-{}.pdf", source.snapshot.invoice_number),
        &hash(&bytes),
        &bytes,
    )
    .await
}

pub async fn get(state: &AppState, id: Uuid) -> Result<Notification, AppError> {
    let row = repository::get(state.db(), id).await?;
    Ok(Notification {
        id: row.id,
        invoice_id: row.invoice_id,
        kind: row.kind,
        state: row.state,
        preview_version: row.preview_version,
        snapshot: row.snapshot,
        artifact_id: row.artifact_id,
        recipients: repository::recipients(state.db(), id).await?,
        created_at: row.created_at,
        can_send: state.notifications().can_send(),
    })
}

pub async fn prepare(
    state: &AppState,
    invoice_id: Uuid,
    input: PrepareInput,
    actor: &str,
) -> Result<Notification, AppError> {
    let source = source(state, invoice_id, &input.kind).await?;
    let event_key = if input.resend_of.is_some() {
        format!("resend:{}", input.request_id)
    } else {
        match input.kind.as_str() {
            "invoice_created" => "created".into(),
            "invoice_updated" => format!("updated:{}", source.snapshot.revision),
            "invoice_ready" => format!("ready:{}", source.generation),
            _ => format!("manual:{}", input.request_id),
        }
    };
    if let Some(existing) = repository::event(state.db(), invoice_id, &event_key).await? {
        if existing.source_hash == source.snapshot.source_hash {
            return get(state, existing.id).await;
        }
        if existing.state == "approved" && input.kind == "invoice_created" {
            return Err(AppError::Conflict("This invoice already has an approved creation notification. Use Resend invoice to preview the current version.".into()));
        }
    }
    let artifact_id = if input.kind == "invoice_ready" {
        None
    } else {
        Some(artifact(state, invoice_id, &source).await?)
    };
    let mut tx = state.db().begin().await?;
    let current = repository::lock_invoice(&mut tx, invoice_id).await?;
    if current != source.snapshot.revision {
        return Err(AppError::Conflict(
            "The invoice changed while rendering. Refresh the preview.".into(),
        ));
    }
    if let Some(approved) = repository::approved_event(&mut tx, invoice_id, &event_key).await? {
        if approved.source_hash == source.snapshot.source_hash && approved.state == "approved" {
            tx.commit().await?;
            return get(state, approved.id).await;
        }
        return Err(AppError::Conflict("This event already has an approved notification. Use Preview resend in notification history to review a new message.".into()));
    }
    if let Some(original) = input.resend_of {
        let belongs = repository::belongs_to_invoice(&mut tx, original, invoice_id).await?;
        if !belongs {
            return Err(AppError::BadRequest(
                "The original notification belongs to a different invoice.".into(),
            ));
        }
    }
    // A second request may have prepared the same event while rendering.
    let existing = repository::lock_event(&mut tx, invoice_id, &event_key).await?;
    if let Some((id, ref hash)) = existing {
        if hash == &source.snapshot.source_hash {
            tx.commit().await?;
            return get(state, id).await;
        }
    }
    if let Some((id, _)) = existing {
        repository::mark_stale(&mut tx, id).await?;
    }
    let id = repository::insert_notification(
        &mut tx,
        invoice_id,
        &input,
        &event_key,
        &source.snapshot,
        artifact_id,
        actor,
    )
    .await?;
    for recipient in &source.recipients {
        repository::insert_recipient(&mut tx, id, recipient).await?;
    }
    tx.commit().await?;
    get(state, id).await
}

pub async fn approve(
    state: &AppState,
    id: Uuid,
    input: SendInput,
    actor: &str,
    send: bool,
) -> Result<Notification, AppError> {
    let notification = repository::get(state.db(), id).await?;
    if send && !state.notifications().can_send() {
        return Err(AppError::Unavailable("WhatsApp delivery is not enabled or configured. The invoice is saved; this preview can be sent after configuration.".into()));
    }
    let source = source(state, notification.invoice_id, &notification.kind).await?;
    if source.snapshot.source_hash != notification.source_hash {
        let mut tx = state.db().begin().await?;
        repository::lock_invoice(&mut tx, notification.invoice_id).await?;
        repository::lock_notification(&mut tx, id).await?;
        repository::mark_stale(&mut tx, id).await?;
        tx.commit().await?;
        return Err(AppError::Conflict(
            "This preview is out of date. Refresh it before sending.".into(),
        ));
    }
    let selected: BTreeSet<String> = input.selected_mobiles.iter().cloned().collect();
    if selected.is_empty() && send {
        return Err(AppError::BadRequest(
            "Select at least one unique mobile number.".into(),
        ));
    }
    let mut tx = state.db().begin().await?;
    let revision = repository::lock_invoice(&mut tx, notification.invoice_id).await?;
    let (status, version) = repository::lock_notification(&mut tx, id).await?;
    if version != input.preview_version || revision != source.snapshot.revision {
        return Err(AppError::Conflict(
            "The invoice or preview changed. Refresh before sending.".into(),
        ));
    }
    let valid = repository::mobiles(&mut tx, id, false).await?;
    if !selected.iter().all(|v| valid.contains(v)) || selected.len() != input.selected_mobiles.len()
    {
        return Err(AppError::BadRequest(
            "Recipients must be unique destinations from this preview.".into(),
        ));
    }
    if status == "approved" && send {
        let previous: BTreeSet<String> = repository::mobiles(&mut tx, id, true)
            .await?
            .into_iter()
            .collect();
        if previous != selected {
            return Err(AppError::Conflict(
                "This notification was already approved with different recipients.".into(),
            ));
        }
        tx.commit().await?;
        return get(state, id).await;
    }
    if status != "draft" {
        return Err(AppError::Conflict(
            "Only a current draft can be approved. Prepare a new preview.".into(),
        ));
    }
    let selected: Vec<String> = selected.into_iter().collect();
    repository::select_recipients(&mut tx, id, &selected, send).await?;
    if send {
        repository::approve(&mut tx, id, actor).await?;
    } else {
        repository::refresh_version(&mut tx, id).await?;
    }
    tx.commit().await?;
    get(state, id).await
}

pub async fn cancel(state: &AppState, id: Uuid) -> Result<Notification, AppError> {
    let notification = repository::get(state.db(), id).await?;
    let mut tx = state.db().begin().await?;
    repository::lock_invoice(&mut tx, notification.invoice_id).await?;
    repository::lock_notification(&mut tx, id).await?;
    let started = repository::has_started(&mut tx, id).await?;
    if started {
        return Err(AppError::Conflict(
            "Sending has already started. This message cannot be recalled.".into(),
        ));
    }
    repository::cancel(&mut tx, id).await?;
    tx.commit().await?;
    get(state, id).await
}

pub async fn document(state: &AppState, invoice_id: Uuid) -> Result<Uuid, AppError> {
    let source = source(state, invoice_id, "manual_resend").await?;
    artifact(state, invoice_id, &source).await
}

pub async fn resend(
    state: &AppState,
    id: Uuid,
    request_id: Uuid,
    actor: &str,
) -> Result<Notification, AppError> {
    let previous = repository::get(state.db(), id).await?;
    let kind = if previous.kind == "invoice_ready" {
        "invoice_ready"
    } else {
        "manual_resend"
    };
    prepare(
        state,
        previous.invoice_id,
        PrepareInput {
            kind: kind.into(),
            request_id,
            resend_of: Some(id),
        },
        actor,
    )
    .await
}
