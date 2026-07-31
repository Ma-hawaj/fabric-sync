use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{CreateCustomerInput, Customer},
};

pub async fn list_customers(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Customer>, AppError> {
    repository::list_customers(state, params).await
}

pub async fn create_customer(
    state: &AppState,
    input: CreateCustomerInput,
) -> Result<Customer, AppError> {
    let customer_id = repository::create_customer(
        state,
        &input.name,
        &input.mobile_no,
        input.measurement.as_ref(),
    )
    .await?;

    Ok(repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just created"))
}
