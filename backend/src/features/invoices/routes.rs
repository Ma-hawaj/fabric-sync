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
        // The WhatsApp ready-for-collection card — the same self-contained HTML
        // shape, captured to a PNG and sent to the customer once the last order
        // on the invoice is production-complete.
        .route(
            "/invoices/:id/ready-card",
            get(handlers::invoice_ready_card),
        )
        .route("/invoices/:id/receive", post(handlers::receive_invoice))
}
