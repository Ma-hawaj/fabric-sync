use axum::{
    routing::{get, patch, post, put},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/orders", get(handlers::list_orders))
        .route("/orders/:id", patch(handlers::update_order))
        .route("/orders/:id/receive", post(handlers::receive_order))
        .route("/orders/:id/stages/:stageId", post(handlers::set_stage))
        .route(
            "/orders/:id/stages/:stageId/assignee",
            put(handlers::set_assignee),
        )
        .route("/orders/:id/repairs", post(handlers::create_repair))
        .route(
            "/orders/:id/repairs/:repairId",
            patch(handlers::update_repair),
        )
}
