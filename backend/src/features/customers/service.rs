use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{CreateCustomerInput, Customer, UpdateCustomerInput},
};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, AppError> {
    Ok(repository::list_customers(state).await?)
}

pub async fn create_customer(
    state: &AppState,
    input: CreateCustomerInput,
) -> Result<Customer, AppError> {
    let customer_id = repository::create_customer(
        state,
        &input.name,
        &input.mobile_no,
        input.marketing_opt_in,
        input.measurement.as_ref(),
    )
    .await?;

    Ok(repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just created"))
}

pub async fn update_customer(
    state: &AppState,
    customer_id: Uuid,
    input: UpdateCustomerInput,
) -> Result<Customer, AppError> {
    repository::update_customer(state, customer_id, input.marketing_opt_in)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("customer {customer_id} not found")))?;

    Ok(repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just updated"))
}
