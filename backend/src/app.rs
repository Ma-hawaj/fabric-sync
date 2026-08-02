use axum::{middleware, Router};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{
    auth,
    features::{
        customers, gift_cards, health, invoices, locations, materials, order_stages, orders,
        products, users,
    },
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
            customers::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(
            materials::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(
            locations::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(
            invoices::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(orders::router().route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        )))
        .merge(
            products::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(
            gift_cards::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(
            order_stages::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .merge(users::router().route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        )))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
