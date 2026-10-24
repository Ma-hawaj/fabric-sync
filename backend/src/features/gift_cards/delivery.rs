use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgTransaction;
use uuid::Uuid;

use super::{delivery_repository as store, image, repository, service, types::GiftCard};
use crate::{
    error::AppError,
    features::notifications::{service::hash, worker},
    state::AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub source_hash: String,
    pub mobile: String,
    pub bought_for: Option<String>,
    pub body: String,
    pub image_data_url: String,
    pub image_filename: String,
    pub can_send: bool,
    pub unavailable_reason: Option<String>,
    #[serde(skip)]
    pub(super) parameters: Vec<String>,
    #[serde(skip)]
    pub(super) image: image::GiftCardImage,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInput {
    pub source_hash: String,
    pub request_id: Uuid,
}

#[derive(Serialize)]
pub struct DeliveryResult {
    pub state: String,
}

async fn preview_card(state: &AppState, card: &GiftCard) -> Result<Preview, AppError> {
    let config = state.notifications();
    let mobile = service::recipient_phone(
        card.recipient_phone.as_deref().unwrap_or_default(),
        &config.default_region,
    )?;
    let parameters = vec![
        card.bought_for
            .clone()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "there".into()),
        state.invoice_branding().name_en.clone(),
        card.code.clone(),
        format!("{} BHD", crate::document::format_amount(card.balance)),
        card.expires_on
            .map(|d| d.to_string())
            .unwrap_or_else(|| "Never".into()),
    ];
    let mut body = config.gift_card_body.clone();
    for (index, parameter) in parameters.iter().enumerate() {
        body = body.replace(&format!("{{{{{}}}}}", index + 1), parameter);
    }
    if body.contains("{{") {
        return Err(AppError::Unavailable(
            "The gift card template contains an unconfigured parameter.".into(),
        ));
    }
    let today = Utc::now().with_timezone(&state.timezone()?).date_naive();
    let unavailable_reason =
        if !card.is_active || card.balance <= 0.0 || card.expires_on.is_some_and(|d| d < today) {
            Some("Only active gift cards with an available balance can be sent.".into())
        } else if !config.can_send() {
            Some("WhatsApp delivery is not configured.".into())
        } else {
            None
        };
    let image = image::for_card(state, card).await?;
    let source_hash = hash(
        json!({"id":card.id,"mobile":mobile,"parameters":parameters,"body":body,
        "active":card.is_active,"template":config.gift_card_template,"language":config.language,
        "imageSha256":image.sha256})
        .to_string()
        .as_bytes(),
    );
    Ok(Preview {
        source_hash,
        mobile,
        bought_for: card.bought_for.clone(),
        body,
        image_data_url: image.data_url(),
        image_filename: image.filename.clone(),
        image,
        can_send: unavailable_reason.is_none(),
        unavailable_reason,
        parameters,
    })
}

pub async fn preview(state: &AppState, id: Uuid) -> Result<Preview, AppError> {
    let card = repository::get_gift_card(state, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Gift card not found.".into()))?;
    preview_card(state, &card).await
}

pub async fn approve(
    state: &AppState,
    id: Uuid,
    input: SendInput,
    actor: &str,
) -> Result<DeliveryResult, AppError> {
    let mut tx = state.db().begin().await?;
    if !store::lock_card(&mut tx, id).await? {
        return Err(AppError::NotFound("Gift card not found.".into()));
    }
    let existing = store::by_request(&mut tx, input.request_id).await?;
    if let Some((card_id, delivery_state)) = existing {
        if card_id != id {
            return Err(AppError::Conflict(
                "This send request belongs to another gift card.".into(),
            ));
        }
        return Ok(DeliveryResult {
            state: delivery_state,
        });
    }
    // The card lock prevents edits and redemptions while checking the preview.
    let card = repository::get_gift_card_in_tx(&mut tx, id).await?;
    let current = preview_card(state, &card).await?;
    if current.source_hash != input.source_hash {
        return Err(AppError::Conflict(
            "The gift card or recipient changed. Close and reopen the preview.".into(),
        ));
    }
    if let Some(reason) = current.unavailable_reason {
        return Err(AppError::Unavailable(reason));
    }
    if store::pending(&mut tx, id).await? {
        return Err(AppError::Conflict(
            "This gift card is already queued for delivery.".into(),
        ));
    }
    store::insert(
        &mut tx,
        id,
        input.request_id,
        actor,
        &current,
        state.notifications(),
    )
    .await?;
    tx.commit().await?;
    Ok(DeliveryResult {
        state: "queued".into(),
    })
}

pub(crate) async fn tick(state: &AppState) -> Result<(), AppError> {
    store::recover(state.db()).await?;
    if !state.notifications().can_send() {
        return Ok(());
    }
    let candidate = store::candidate(state.db()).await?;
    let Some((id, card_id)) = candidate else {
        return Ok(());
    };
    let mut tx = state.db().begin().await?;
    store::lock_card(&mut tx, card_id).await?;
    let job = store::lock_job(&mut tx, id).await?;
    let Some(job) = job else {
        return Ok(());
    };
    let card = repository::get_gift_card_in_tx(&mut tx, job.gift_card_id).await?;
    let current = preview_card(state, &card).await?;
    let valid = current.can_send && current.source_hash == job.source_hash;
    if !valid {
        store::cancel(&mut tx, id).await?;
        tx.commit().await?;
        return Ok(());
    }
    if hash(&job.image_png) != job.image_sha256 {
        store::status(
            &mut tx,
            id,
            "failed",
            Some(
                "The approved gift card image failed its integrity check. Preview and send again.",
            ),
        )
        .await?;
        tx.commit().await?;
        return Ok(());
    }
    store::claim(&mut tx, id).await?;
    tx.commit().await?;
    let result = worker::send_image_template(
        state,
        &job.normalized_mobile,
        &job.template_name,
        &job.language,
        &job.parameters,
        &job.image_filename,
        job.image_png,
    )
    .await;
    let (status, message_id, error, delay) = match result {
        Ok(id) => ("accepted", Some(id), None, 0),
        Err(e) => {
            let retry = e.retry && job.attempt_count + 1 < state.notifications().max_attempts;
            (
                if e.uncertain {
                    "uncertain"
                } else if retry {
                    "queued"
                } else {
                    "failed"
                },
                None,
                Some(e.message),
                (30_i64 * 2_i64.pow((job.attempt_count + 1).min(5) as u32)).max(e.retry_after),
            )
        }
    };
    store::finish(
        state.db(),
        id,
        status,
        message_id.as_deref(),
        error.as_deref(),
        delay,
    )
    .await?;
    Ok(())
}

pub(crate) async fn webhook(
    tx: &mut PgTransaction<'_>,
    message_id: &str,
    incoming: &str,
    payload: &Value,
) -> Result<bool, AppError> {
    let existing = store::lock_provider(tx, message_id).await?;
    let Some((id, current)) = existing else {
        return Ok(false);
    };
    if let Some(next) = worker::next_status(&current, incoming) {
        let error = (next == "failed").then(|| payload["errors"].to_string());
        store::status(tx, id, next, error.as_deref()).await?;
    }
    Ok(true)
}
