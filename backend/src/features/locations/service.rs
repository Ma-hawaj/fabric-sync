use crate::{error::AppError, state::AppState};

use super::{repository, types::Location};

pub async fn list_locations(state: &AppState) -> Result<Vec<Location>, AppError> {
    Ok(repository::list_locations(state).await?)
}
