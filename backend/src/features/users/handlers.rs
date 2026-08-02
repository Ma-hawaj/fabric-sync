use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::User};

pub async fn list_users(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<User>>, AppError> {
    Ok(Json(service::list_users(&state).await?))
}
