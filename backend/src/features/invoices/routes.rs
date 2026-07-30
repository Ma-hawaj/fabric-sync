use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/invoices",
            get(handlers::list_invoices).post(handlers::create_invoice),
        )
        .route("/invoices/:id", get(handlers::get_invoice))
        // The printable document, as a self-contained HTML page. Separate from
        // the JSON above because it is rendered server-side: the same markup a
        // browser prints to PDF today is what an unattended PDF renderer will
        // be handed later.
        .route("/invoices/:id/document", get(handlers::invoice_document))
        .route("/invoices/:id/receive", post(handlers::receive_invoice))
}
