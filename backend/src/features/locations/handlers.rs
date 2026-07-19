use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::Location};

pub async fn list_locations(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Location>>, AppError> {
    Ok(Json(service::list_locations(&state).await?))
}
