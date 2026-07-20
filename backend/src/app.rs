use axum::{
    // middleware,
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{
    // auth,
    features::{customers, health, locations, materials, orders},
    state::AppState,
};

pub fn router(state: AppState) -> Router {
    // Frontend and backend are deployed/run separately (see CLAUDE.md), so the
    // frontend origin is never known at compile time; auth is bearer-token
    // based rather than cookies, so a permissive `Any` origin carries no
    // credentialed-request risk.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

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
        .merge(orders::router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
