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
}
