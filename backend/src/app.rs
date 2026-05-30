use axum::Router;
use tower_http::trace::TraceLayer;

use crate::{features, state::AppState};

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(features::router())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
