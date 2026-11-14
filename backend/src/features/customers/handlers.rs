use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    auth::AuthenticatedUser,
    error::AppError,
    list::{ListParams, Page},
    state::AppState,
};

use super::{
    service,
    types::{CreateCustomerInput, Customer, UpdateCustomerInput},
};

pub async fn list_customers(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<Customer>>, AppError> {
    let _subject = user.subject();
    let _client_id = user.client_id();
    let _scopes = user.scopes();

    Ok(Json(service::list_customers(&state, &params).await?))
}

pub async fn get_customer(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(customer_id): Path<Uuid>,
) -> Result<Json<Customer>, AppError> {
    Ok(Json(service::get_customer(&state, customer_id).await?))
}

pub async fn create_customer(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateCustomerInput>,
) -> Result<Json<Customer>, AppError> {
    Ok(Json({
        let actor = customer_actor(&user, input.marketing_preference.is_some())?;
        service::create_customer(&state, input, Some(actor)).await?
    }))
}

pub async fn update_customer(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(customer_id): Path<Uuid>,
    Json(input): Json<UpdateCustomerInput>,
) -> Result<Json<Customer>, AppError> {
    Ok(Json({
        let actor = customer_actor(&user, input.marketing_preference.is_some())?;
        service::update_customer(&state, customer_id, input, Some(actor)).await?
    }))
}

fn customer_actor(user: &AuthenticatedUser, marketing_requested: bool) -> Result<&str, AppError> {
    if marketing_requested {
        crate::authorization::authorize(
            user.roles(),
            "PUT",
            "/customers/customer/marketing-consent",
        )?;
    }
    Ok(user.subject().unwrap_or("staff"))
}
