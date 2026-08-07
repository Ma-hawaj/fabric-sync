use axum::{middleware, Router};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    auth,
    features::{
        customers, gift_cards, health, invoices, locations, materials, order_stages, orders,
        products, users,
    },
    request_log,
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
        // Outermost layer: wraps every `require_auth` route layer below (and
        // `/health`, which has none), so it's `Span::current()` for the whole
        // request and can see the final response status regardless of which
        // feature router or middleware produced it. `MatchedPath` is still
        // available here despite being the outer layer — axum sets it on the
        // request right after routing selects a `Route`, before dispatching
        // into that route's (possibly layered) service, so it's already
        // present by the time this middleware body runs; genuinely unmatched
        // paths just fall back to the raw URI (see request_log.rs).
        .layer(middleware::from_fn(request_log::log_request))
        .with_state(state)
}
