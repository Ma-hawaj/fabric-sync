use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};

use crate::{error::AppError, state::AppState};

use super::{service, till_service, types::*};
use uuid::Uuid;

pub async fn sales_closing(
    State(state): State<AppState>,
    Query(query): Query<ClosingQuery>,
) -> Result<Json<SalesClosing>, AppError> {
    Ok(Json(
        service::sales_closing(&state, query.date, query.branch_id).await?,
    ))
}

pub async fn save_check(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Json(input): Json<SaveClosingInput>,
) -> Result<Json<ClosingCheck>, AppError> {
    let actor = actor(&user)?;
    Ok(Json(service::save_check(&state, input, actor).await?))
}

fn actor(user: &crate::auth::AuthenticatedUser) -> Result<&str, AppError> {
    user.subject()
        .filter(|subject| !subject.trim().is_empty())
        .ok_or_else(|| {
            AppError::Forbidden("A staff identity is required to save a closing check.".into())
        })
}

pub async fn day_status(
    State(state): State<AppState>,
    Query(query): Query<ClosingQuery>,
) -> Result<Json<BranchDayStatus>, AppError> {
    Ok(Json(
        super::day_service::status(&state, query.branch_id).await?,
    ))
}

pub async fn close_day(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Json(input): Json<CloseDayInput>,
) -> Result<Json<SalesClosing>, AppError> {
    Ok(Json(
        super::day_service::close_day(&state, input, actor(&user)?).await?,
    ))
}

pub async fn save_opening(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Json(input): Json<SaveOpeningInput>,
) -> Result<Json<CashOpening>, AppError> {
    Ok(Json(
        till_service::save_opening(&state, input, None, actor(&user)?).await?,
    ))
}

pub async fn correct_opening(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<SaveOpeningInput>,
) -> Result<Json<CashOpening>, AppError> {
    Ok(Json(
        till_service::save_opening(&state, input, Some(id), actor(&user)?).await?,
    ))
}

pub async fn record_expense(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Json(input): Json<RecordExpenseInput>,
) -> Result<Json<BranchExpense>, AppError> {
    Ok(Json(
        till_service::record_expense(&state, input, actor(&user)?).await?,
    ))
}

pub async fn void_expense(
    State(state): State<AppState>,
    Extension(user): Extension<crate::auth::AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<VoidExpenseInput>,
) -> Result<Json<BranchExpense>, AppError> {
    Ok(Json(
        till_service::void_expense(&state, id, input, actor(&user)?).await?,
    ))
}
