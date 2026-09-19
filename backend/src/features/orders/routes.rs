use axum::{
    routing::{get, patch, post, put},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/orders", get(handlers::list_orders))
        .route(
            "/orders/:id",
            get(handlers::get_order).patch(handlers::update_order),
        )
        // The printable order, as a self-contained HTML page. Separate from the
        // JSON above because it is rendered server-side: the same markup a
        // browser prints to PDF today is what an unattended PDF renderer will
        // be handed later.
        .route("/orders/:id/document", get(handlers::order_document))
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
