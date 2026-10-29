use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::User};

pub async fn list_users(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<User>>, AppError> {
    let mut users = service::list_users(&state).await?;
    if !user.has_any_role(&[crate::authorization::Role::Manager]) {
        for entry in &mut users {
            entry.email = None;
            entry.roles.clear();
            entry.groups.clear();
        }
    }
    Ok(Json(users))
}
