use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/me/preferences",
        get(handlers::get_preferences).put(handlers::update_preferences),
    )
}
