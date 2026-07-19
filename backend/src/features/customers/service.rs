use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{CreateCustomerInput, Customer},
};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, AppError> {
    Ok(repository::list_customers(state).await?)
}

pub async fn create_customer(
    state: &AppState,
    input: CreateCustomerInput,
) -> Result<Customer, AppError> {
    let customer_id = repository::create_customer(state, &input.name, &input.mobile_no).await?;

    Ok(repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just created"))
}
