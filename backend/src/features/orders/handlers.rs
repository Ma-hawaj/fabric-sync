use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::Order};

pub async fn list_orders(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Order>>, AppError> {
    Ok(Json(service::list_orders(&state).await?))
}

pub async fn receive_order(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(order_id): Path<Uuid>,
) -> Result<Json<Order>, AppError> {
    Ok(Json(service::receive_order(&state, order_id).await?))
}
