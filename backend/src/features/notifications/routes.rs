use super::handlers;
use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/notifications/capabilities", get(handlers::capabilities))
        .route(
            "/invoices/:id/notifications",
            get(handlers::history).post(handlers::prepare),
        )
        .route(
            "/notifications/:id",
            get(handlers::get).delete(handlers::discard_preview),
        )
        .route("/notifications/:id/send", post(handlers::send))
        .route("/notifications/:id/selection", post(handlers::selection))
        .route("/notifications/:id/cancel", post(handlers::cancel))
        .route("/notifications/:id/resend", post(handlers::resend))
        .route("/notifications/:id/sends", get(handlers::sends))
        .route("/invoices/:id/documents", post(handlers::document))
        .route("/documents/:id", get(handlers::metadata))
        .route("/documents/:id/content", get(handlers::content))
}
pub fn webhook_router() -> Router<AppState> {
    Router::new().route(
        "/webhooks/whatsapp",
        get(handlers::verify).post(handlers::webhook),
    )
}
