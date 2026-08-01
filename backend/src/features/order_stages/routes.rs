use axum::{
    routing::{get, patch},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/order-stages",
            get(handlers::list_stages).post(handlers::create_stage),
        )
        .route("/order-stages/:id", patch(handlers::update_stage))
}
