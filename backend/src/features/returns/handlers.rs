use super::{service, types::*};
use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

pub async fn cancellation_context(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<CancellationContext>, AppError> {
    Ok(Json(service::cancellation_context(&state, id).await?))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<CreateCancellationInput>,
) -> Result<Json<RecordedAdjustment>, AppError> {
    let actor = user.subject().ok_or_else(|| {
        AppError::Unauthorized("a user identity is required to cancel an order".into())
    })?;
    Ok(Json(service::cancel_order(&state, id, input, actor).await?))
}

pub async fn context(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReturnContext>, AppError> {
    Ok(Json(service::context(&state, id).await?))
}

pub async fn create_return(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<CreateReturnInput>,
) -> Result<Json<RecordedAdjustment>, AppError> {
    let actor = user.subject().ok_or_else(|| {
        AppError::Unauthorized("a user identity is required to record a return".into())
    })?;
    Ok(Json(
        service::create_return(&state, id, input, actor).await?,
    ))
}

pub async fn create_refund(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<CreateRefundInput>,
) -> Result<Json<RecordedAdjustment>, AppError> {
    let actor = user.subject().ok_or_else(|| {
        AppError::Unauthorized("a user identity is required to record a refund".into())
    })?;
    Ok(Json(
        service::create_refund(&state, id, input, actor).await?,
    ))
}
