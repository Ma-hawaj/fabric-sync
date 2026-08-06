use axum::{
    routing::{get, patch},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/customers",
            get(handlers::list_customers).post(handlers::create_customer),
        )
        .route("/customers/:id", patch(handlers::update_customer))
}
