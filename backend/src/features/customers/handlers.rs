use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{CreateCustomerInput, Customer},
};

pub async fn list_customers(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Customer>>, AppError> {
    let _subject = user.subject();
    let _client_id = user.client_id();
    let _scopes = user.scopes();

    Ok(Json(service::list_customers(&state).await?))
}

pub async fn create_customer(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateCustomerInput>,
) -> Result<Json<Customer>, AppError> {
    Ok(Json(service::create_customer(&state, input).await?))
}
