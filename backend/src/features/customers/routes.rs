use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/customers/:id/merge", post(handlers::merge_customer))
        .route(
            "/customers",
            get(handlers::list_customers).post(handlers::create_customer),
        )
        .route(
            "/customers/:id",
            get(handlers::get_customer).patch(handlers::update_customer),
        )
}
