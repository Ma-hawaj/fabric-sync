use axum::{
    routing::{get, patch},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/locations",
            get(handlers::list_locations).post(handlers::create_location),
        )
        .route("/locations/:id", patch(handlers::update_location))
}
