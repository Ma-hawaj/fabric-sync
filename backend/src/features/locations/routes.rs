use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new().route("/locations", get(handlers::list_locations))
}
