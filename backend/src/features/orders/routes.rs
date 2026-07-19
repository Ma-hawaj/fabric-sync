use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new().route("/orders", get(handlers::list_orders))
}
