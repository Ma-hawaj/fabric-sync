use super::handlers;
use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/invoices/:id/returns",
            get(handlers::context).post(handlers::create_return),
        )
        .route("/invoices/:id/refunds", post(handlers::create_refund))
        .route(
            "/orders/:id/cancel",
            get(handlers::cancellation_context).post(handlers::cancel_order),
        )
}
