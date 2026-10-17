use axum::{
    extract::DefaultBodyLimit,
    routing::{get, patch},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/design-options",
            get(handlers::list_options).post(handlers::create_option),
        )
        .route("/design-options/:id", patch(handlers::update_option))
        // A 2 MiB raw image is ~2.67 MiB after base64 encoding, before the
        // JSON envelope. Keep the service's raw-byte cap, but let valid
        // uploads reach it instead of Axum rejecting them at 2 MiB.
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
}

/// The illustration bytes, served without auth: an `<img>` can't attach the
/// bearer token the picker would otherwise send, and catalog thumbnails carry
/// nothing sensitive. Merged in `app.rs` without the `require_auth` layer.
pub fn public_router() -> Router<AppState> {
    Router::new().route("/design-options/:id/image", get(handlers::get_image))
}
