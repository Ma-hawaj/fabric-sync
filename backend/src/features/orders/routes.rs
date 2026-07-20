use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/orders", get(handlers::list_orders))
        .route("/orders/:id/receive", post(handlers::receive_order))
}
