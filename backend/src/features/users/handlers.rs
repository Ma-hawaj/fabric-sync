use axum::{extract::State, Json};

use crate::state::AppState;

use super::{service, types::UserResponse};

pub async fn list_users(State(state): State<AppState>) -> Json<Vec<UserResponse>> {
    Json(service::list_users(&state))
}
