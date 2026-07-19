use axum::{
    // middleware,
    Router,
};
use tower_http::trace::TraceLayer;

use crate::{
    // auth,
    features::{customers, health, locations, materials},
    state::AppState,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(health::router())
        .merge(
            customers::router(), //     .route_layer(
                                 //     middleware::from_fn_with_state(
                                 //     state.clone(),
                                 //     auth::require_auth,
                                 // )),
        )
        .merge(materials::router())
        .merge(locations::router())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
