use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/marketing-messages",
            get(handlers::list_campaigns).post(handlers::create_campaign),
        )
        .route("/marketing-messages/:id", get(handlers::get_campaign))
}
