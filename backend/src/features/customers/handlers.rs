use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{service, types::Customer};

pub async fn list_customers(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Customer>>, AppError> {
    let _subject = user.subject();
    let _client_id = user.client_id();
    let _scopes = user.scopes();

    Ok(Json(service::list_customers(&state).await?))
}
