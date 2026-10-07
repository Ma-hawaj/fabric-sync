use axum::{http::StatusCode, middleware, Router};
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
};

use crate::{
    auth,
    features::{
        customers, gift_cards, health, invoices, locations, materials, order_stages, orders,
        preferences, products, users,
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

    // Every domain API lives under `/api` so the same origin can also serve
    // the SPA: the frontend is built with `VITE_API_BASE_URL=/api` and calls
    // `/api/customers` etc., while the static files own every other path.
    // Nesting (rather than prefixing each feature router) keeps the feature
    // modules untouched — they keep declaring bare `/customers`-style paths.
    // The inner fallback keeps unknown `/api/*` paths a 404 instead of
    // falling through to the SPA's `index.html`.
    let api = Router::new()
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
        .merge(
            preferences::router().route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::require_auth,
            )),
        )
        .fallback(|| async { (StatusCode::NOT_FOUND, "not found") });

    // The built SPA (`vite build` output, see STATIC_DIR). Unknown non-API
    // paths fall back to `index.html` so client-side routing (TanStack
    // Router) handles them; a missing directory simply 404s everything
    // except the API (plain `cargo run` without a frontend build).
    //
    // This is `fallback`, not `not_found_service`: the latter forces the
    // response status to 404 (meant for custom not-found pages), while the
    // SPA entry point must answer 200 for client-side routes.
    let static_dir = state.static_dir().to_string();
    let index = format!("{static_dir}/index.html");
    let spa = ServeDir::new(&static_dir).fallback(ServeFile::new(&index));

    Router::new()
        .merge(health::router())
        .nest("/api", api)
        .fallback_service(spa)
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
