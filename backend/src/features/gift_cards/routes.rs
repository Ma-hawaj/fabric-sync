use axum::{
    routing::{get, patch},
    Router,
};

use crate::state::AppState;

use super::handlers;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/gift-cards",
            get(handlers::list_gift_cards).post(handlers::create_gift_card),
        )
        .route("/gift-cards/:id", patch(handlers::update_gift_card))
}
