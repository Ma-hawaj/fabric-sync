use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/invoices",
        get(handlers::list_invoices).post(handlers::create_invoice),
    )
}
