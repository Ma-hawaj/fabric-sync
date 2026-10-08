use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/products",
            get(handlers::list_products).post(handlers::create_product),
        )
        .route(
            "/products/:id",
            get(handlers::get_product).patch(handlers::update_product),
        )
        .route("/products/:id/stock", post(handlers::add_stock))
}
