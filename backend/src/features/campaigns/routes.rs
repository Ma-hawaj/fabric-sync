use super::handlers as h;
use crate::state::AppState;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/campaigns", get(h::list).post(h::create))
        .route("/campaigns/capabilities", get(h::capabilities))
        .route("/campaigns/audience-count", post(h::audience_count))
        .route("/campaigns/:id", get(h::get).patch(h::update))
        .route("/campaigns/:id/preview", post(h::preview))
        .route("/campaigns/:id/approve", post(h::approve))
        .route("/campaigns/:id/cancel", post(h::cancel))
        .route("/campaigns/:id/recipients", get(h::recipients))
        .route(
            "/campaign-templates",
            get(h::templates).post(h::create_template),
        )
        .route("/campaign-templates/sync", post(h::sync))
        .route(
            "/campaign-templates/:id",
            axum::routing::patch(h::update_template),
        )
        .route("/campaign-templates/:id/submit", post(h::submit))
        .route("/campaign-templates/:id/archive", post(h::archive))
        .route(
            "/campaign-assets",
            post(h::upload).layer(DefaultBodyLimit::max(7 * 1024 * 1024 + 4096)),
        )
        .route("/campaign-assets/:id", get(h::asset))
        .route(
            "/customers/:id/marketing-consent",
            get(h::consent).put(h::save_consent),
        )
}
