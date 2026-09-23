use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    auth::AuthenticatedUser,
    error::AppError,
    list::{ListParams, Page},
    state::AppState,
};

use super::{
    service,
    types::{CreateLocationInput, Location, UpdateLocationInput},
};

pub async fn list_locations(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<Location>>, AppError> {
    Ok(Json(service::list_locations(&state, &params).await?))
}

pub async fn create_location(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateLocationInput>,
) -> Result<Json<Location>, AppError> {
    Ok(Json(service::create_location(&state, input).await?))
}

pub async fn update_location(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(location_id): Path<Uuid>,
    Json(input): Json<UpdateLocationInput>,
) -> Result<Json<Location>, AppError> {
    Ok(Json(
        service::update_location(&state, location_id, input).await?,
    ))
}
