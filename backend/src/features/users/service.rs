use crate::{error::AppError, state::AppState};

use super::types::User;

pub async fn list_users(state: &AppState) -> Result<Vec<User>, AppError> {
    state.zitadel_users().list_users().await
}
