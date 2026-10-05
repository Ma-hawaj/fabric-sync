use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/materials",
            get(handlers::list_materials).post(handlers::create_material),
        )
        .route("/materials/:id/stock", post(handlers::add_stock))
        // Taking stock off without deleting the material — wastage, samples,
        // or a correction. Separate from the add above because every entry is
        // guarded against the location's live quantity instead of upserted.
        .route("/materials/:id/stock/remove", post(handlers::remove_stock))
}
