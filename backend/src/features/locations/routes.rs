use axum::{routing::get, Router};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/locations",
            get(handlers::list_locations).post(handlers::create_location),
        )
        .route("/locations/options", get(handlers::location_options))
        .route(
            "/locations/:id",
            get(handlers::get_location).patch(handlers::update_location),
        )
}
