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
    types::{
        AssignStageInput, CreateRepairInput, OrderListItem, ReceiveOrderInput, SetStageInput,
        UpdateOrderInput, UpdateRepairInput,
    },
};

pub async fn list_orders(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<OrderListItem>>, AppError> {
    Ok(Json(service::list_orders(&state, &params).await?))
}

pub async fn receive_order(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<ReceiveOrderInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(
        service::receive_order(&state, order_id, input.payment_type).await?,
    ))
}

pub async fn update_order(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<UpdateOrderInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(service::update_order(&state, order_id, input).await?))
}

pub async fn set_stage(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path((order_id, stage_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SetStageInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(
        service::set_stage(&state, order_id, stage_id, input).await?,
    ))
}

pub async fn set_assignee(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path((order_id, stage_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<AssignStageInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(
        service::set_assignee(&state, order_id, stage_id, input).await?,
    ))
}

pub async fn create_repair(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<CreateRepairInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(service::create_repair(&state, order_id, input).await?))
}

pub async fn update_repair(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path((order_id, repair_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateRepairInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(
        service::update_repair(&state, order_id, repair_id, input).await?,
    ))
}
