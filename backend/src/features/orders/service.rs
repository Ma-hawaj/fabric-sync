use crate::{error::AppError, state::AppState};

use super::{repository, types::OrderListItem};

pub async fn list_orders(state: &AppState) -> Result<Vec<OrderListItem>, AppError> {
    Ok(repository::list_orders(state).await?)
}
