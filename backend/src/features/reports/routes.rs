use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sales-closing", get(super::handlers::sales_closing))
        .route("/sales-closing/status", get(super::handlers::day_status))
        .route(
            "/sales-closing/setup",
            post(super::handlers::configure_closing),
        )
        .route(
            "/sales-closing/missed",
            post(super::handlers::resolve_missed),
        )
        .route("/sales-closing/close", post(super::handlers::close_day))
        .route("/sales-closing/checks", post(super::handlers::save_check))
        .route(
            "/sales-closing/openings",
            post(super::handlers::save_opening),
        )
        .route(
            "/sales-closing/openings/:id/corrections",
            post(super::handlers::correct_opening),
        )
        .route(
            "/sales-closing/expenses",
            post(super::handlers::record_expense),
        )
        .route(
            "/sales-closing/expenses/:id/void",
            post(super::handlers::void_expense),
        )
}
