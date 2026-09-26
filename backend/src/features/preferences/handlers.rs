use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{Preferences, UpdatePreferencesInput},
};

pub async fn get_preferences(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Preferences>, AppError> {
    Ok(Json(service::get_preferences(&state, &user).await?))
}

pub async fn update_preferences(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<UpdatePreferencesInput>,
) -> Result<Json<Preferences>, AppError> {
    Ok(Json(
        service::update_preferences(&state, &user, input).await?,
    ))
}
