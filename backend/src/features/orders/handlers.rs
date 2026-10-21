use axum::{
    extract::{Path, State},
    response::Html,
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
    document, service,
    types::{
        AssignStageInput, CollectOrderInput, CreateRepairInput, OrderDetail, OrderListItem,
        SetStageInput, UpdateOrderInput, UpdateRepairInput,
    },
};

pub async fn list_orders(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<OrderListItem>>, AppError> {
    Ok(Json(service::list_orders(&state, &params).await?))
}

pub async fn get_order(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
) -> Result<Json<OrderDetail>, AppError> {
    Ok(Json(service::get_order(&state, order_id).await?))
}

/// The printable order, as HTML. Fetched rather than navigated to — the client
/// writes it into an iframe and prints that — so it can carry an Authorization
/// header once there is one to carry.
pub async fn order_document(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
) -> Result<Html<String>, AppError> {
    Ok(Html(
        document::render_order_document(&state, order_id).await?,
    ))
}

pub async fn collect_order(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<CollectOrderInput>,
) -> Result<Json<OrderListItem>, AppError> {
    Ok(Json(
        service::collect_order(&state, order_id, input.amount, input.payment_type).await?,
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

pub async fn mark_ready(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<super::readiness::ConfirmInput>,
) -> Result<Json<super::readiness::ReadyResult>, AppError> {
    let invoice_id = super::readiness::invoice_for_order(state.db(), order_id).await?;
    Ok(Json(
        super::readiness::confirm(
            state.db(),
            invoice_id,
            Some(order_id),
            user.subject().unwrap_or("staff"),
            input.confirmed_at_pickup_branch,
        )
        .await?,
    ))
}

pub async fn reopen(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
    Json(input): Json<super::readiness::ReopenInput>,
) -> Result<Json<OrderListItem>, AppError> {
    super::readiness::reopen(
        state.db(),
        order_id,
        user.subject().unwrap_or("staff"),
        &input.reason,
    )
    .await?;
    Ok(Json(service::get_order(&state, order_id).await?.order))
}
