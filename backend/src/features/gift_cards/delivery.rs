use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgTransaction;
use uuid::Uuid;

use super::{image, repository, service, types::GiftCard};
use crate::{
    error::AppError,
    features::notifications::{
        repository as store,
        service::hash,
        types::{Customer, Destination, Snapshot},
    },
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
    store::lock_gift_card(&mut tx, id).await?;
    let existing = store::gift_card_send_by_command(&mut tx, input.request_id).await?;
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
    if store::gift_card_pending(&mut tx, id).await? {
        return Err(AppError::Conflict(
            "This gift card is already queued for delivery.".into(),
        ));
    }
    let notification_request =
        crate::features::notifications::repository::ensure_gift_card_request(&mut tx, id).await?;
    let artifact = store::store_image(
        &mut tx,
        id,
        &current.source_hash,
        &current.image.filename,
        &current.image.sha256,
        &current.image.png,
    )
    .await?;
    let snapshot = Snapshot {
        repair_id: None,
        invoice_number: None,
        source_hash: current.source_hash,
        revision: 0,
        body: current.body,
        template_name: state.notifications().gift_card_template.clone(),
        language: state.notifications().language.clone(),
        parameters: current.parameters,
        exclusions: vec![],
    };
    let notification = store::insert_send(
        &mut tx,
        store::NewSend {
            request: notification_request,
            kind: "gift_card",
            event_key: &format!("gift:{}", input.request_id),
            command: Some(input.request_id),
            snapshot: &snapshot,
            artifact: Some(artifact),
            actor,
            resend_of: None,
        },
    )
    .await?;
    store::insert_recipient(
        &mut tx,
        notification,
        &Destination {
            mobile: current.mobile.clone(),
            customers: vec![Customer {
                id,
                name: current
                    .bought_for
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| "Gift card recipient".into()),
                mobile_no: current.mobile.clone(),
                enabled: true,
            }],
            excluded_reason: None,
        },
    )
    .await?;
    store::select_recipients(&mut tx, notification, &[current.mobile], true).await?;
    store::approve(&mut tx, notification, actor).await?;
    tx.commit().await?;
    Ok(DeliveryResult {
        state: "queued".into(),
    })
}

// Keep card-specific content and eligibility checks separate from delivery.
// The shared worker holds the card lock through its claim, so edits/redemptions
// cannot slip between this check and the cancellation cutoff.
pub(crate) async fn validate(
    state: &AppState,
    tx: &mut PgTransaction<'_>,
    id: Uuid,
    source_hash: &str,
) -> Result<bool, AppError> {
    let card = repository::get_gift_card_in_tx(tx, id).await?;
    let current = preview_card(state, &card).await?;
    Ok(current.can_send && current.source_hash == source_hash)
}
