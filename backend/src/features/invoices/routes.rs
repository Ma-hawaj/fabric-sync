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
        .route(
            "/invoices/:id",
            get(handlers::get_invoice).put(handlers::update_invoice),
        )
        .route("/invoices/:id/edit", get(handlers::get_invoice_for_edit))
        // The printable document, as a PDF rendered from the self-contained
        // HTML template by headless Chromium (see document.rs). Separate from
        // the JSON above because it is rendered server-side.
        .route("/invoices/:id/document", get(handlers::invoice_document))
        .route("/invoices/:id/receive", post(handlers::receive_invoice))
        // A till payment taken without collecting anything — an extra advance
        // or the remainder after everything was collected. Separate from
        // receive because no order changes state.
        .route("/invoices/:id/payments", post(handlers::record_payment))
}
