use crate::state::AppState;

use super::{repository, types::UserResponse};

pub fn list_users(state: &AppState) -> Vec<UserResponse> {
    repository::list_users(state)
        .into_iter()
        .map(UserResponse::from)
        .collect()
}
