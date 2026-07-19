use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{AddStockInput, CreateMaterialInput, Material},
};

pub async fn list_materials(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Material>>, AppError> {
    Ok(Json(service::list_materials(&state).await?))
}

pub async fn create_material(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateMaterialInput>,
) -> Result<Json<Material>, AppError> {
    Ok(Json(service::create_material(&state, input).await?))
}

pub async fn add_stock(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(material_id): Path<Uuid>,
    Json(input): Json<AddStockInput>,
) -> Result<Json<Material>, AppError> {
    Ok(Json(service::add_stock(&state, material_id, input).await?))
}
