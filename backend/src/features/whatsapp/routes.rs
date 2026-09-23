use axum::{extract::DefaultBodyLimit, routing::post, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    // The invoice image rides in as base64 JSON, so the body of one send is
    // ~1.3x the pixel data — comfortably over axum's 2 MB default limit. Sized
    // for WhatsApp's 5 MB image cap (see service::MAX_IMAGE_BYTES).
    Router::new()
        .route(
            "/whatsapp/invoices/:id/messages",
            post(handlers::send_invoice_message),
        )
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
}
