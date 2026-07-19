use axum::{routing::post, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new().route("/invoices", post(handlers::create_invoice))
}
