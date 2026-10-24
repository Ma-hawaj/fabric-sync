use axum::{
    routing::{get, patch, post},
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
        .route("/gift-cards/:id/preview", get(handlers::preview_delivery))
        .route("/gift-cards/:id/image", get(handlers::download_image))
        .route("/gift-cards/:id/send", post(handlers::send_gift_card))
        // Three segments, so it can't collide with `/gift-cards/:id` above.
        .route(
            "/gift-cards/by-code/:code",
            get(handlers::get_gift_card_by_code),
        )
}
