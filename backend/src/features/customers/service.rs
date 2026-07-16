use crate::{error::AppError, state::AppState};

use super::{repository, types::Customer};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, AppError> {
    Ok(repository::list_customers(state).await?)
}
