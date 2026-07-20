use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::OrderListItem};

pub async fn list_orders(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<OrderListItem>>, AppError> {
    Ok(Json(service::list_orders(&state).await?))
}
