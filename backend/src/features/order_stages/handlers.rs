use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{CreateOrderStageInput, OrderStage, UpdateOrderStageInput},
};

pub async fn list_stages(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<OrderStage>>, AppError> {
    Ok(Json(service::list_stages(&state).await?))
}

pub async fn create_stage(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateOrderStageInput>,
) -> Result<Json<OrderStage>, AppError> {
    Ok(Json(service::create_stage(&state, input).await?))
}

pub async fn update_stage(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(stage_id): Path<Uuid>,
    Json(input): Json<UpdateOrderStageInput>,
) -> Result<Json<OrderStage>, AppError> {
    Ok(Json(service::update_stage(&state, stage_id, input).await?))
}
