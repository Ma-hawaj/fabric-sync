use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::types::{SendInvoiceMessageRequest, SendInvoiceMessageResponse};

/// Sends a customer-facing image of the invoice to the named WhatsApp number.
/// The image is captured client-side from `GET /invoices/:id/document` (a
/// browser rasterizes the HTML); this endpoint uploads it to the Cloud API and
/// sends it, resolving the recipient and the caption itself.
pub async fn send_invoice_message(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(invoice_id): Path<Uuid>,
    Json(input): Json<SendInvoiceMessageRequest>,
) -> Result<Json<SendInvoiceMessageResponse>, AppError> {
    let whatsapp = state.whatsapp().ok_or_else(|| {
        AppError::BadRequest(
            "WhatsApp sending is not configured on this server — set \
             WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN"
                .to_string(),
        )
    })?;

    // Loading the invoice does double duty: a 404 on an unknown id, and the
    // authoritative source for the caption text (never trusted from the
    // client).
    let invoice = crate::features::invoices::service::get_invoice(&state, invoice_id).await?;

    let message_id = whatsapp
        .send_invoice_image(
            state.invoice_branding(),
            &invoice,
            &input.to,
            &input.mime_type,
            &input.media_base64,
        )
        .await?;

    Ok(Json(SendInvoiceMessageResponse { message_id }))
}
