use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{CreateCustomerInput, Customer, UpdateCustomerInput},
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
    let name = normalized_field(&input.name, "customer name")?;
    let mobile_no = normalized_field(&input.mobile_no, "phone number")?;

    let customer_id =
        repository::create_customer(state, &name, &mobile_no, input.measurement.as_ref()).await?;

    let customer = repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just created");

    tracing::info!(customer_id = %customer.id, "customer created");

    Ok(customer)
}

fn normalized_field(value: &str, label: &str) -> Result<String, AppError> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{label} cannot be empty")));
    }

    Ok(trimmed.to_string())
}

pub async fn update_customer(
    state: &AppState,
    customer_id: Uuid,
    input: UpdateCustomerInput,
) -> Result<Customer, AppError> {
    let name = input
        .name
        .as_deref()
        .map(|name| normalized_field(name, "customer name"))
        .transpose()?;
    let mobile_no = input
        .mobile_no
        .as_deref()
        .map(|mobile_no| normalized_field(mobile_no, "phone number"))
        .transpose()?;

    if name.is_none() && mobile_no.is_none() {
        return Err(AppError::BadRequest("nothing to update".to_string()));
    }

    let customer =
        repository::update_customer(state, customer_id, name.as_deref(), mobile_no.as_deref())
            .await?
            .ok_or_else(|| AppError::NotFound(format!("customer {customer_id} not found")))?;

    tracing::info!(customer_id = %customer_id, "customer updated");

    Ok(customer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_field_trims_surrounding_whitespace() {
        assert_eq!(
            normalized_field("  Layla Haddad \n", "customer name").unwrap(),
            "Layla Haddad"
        );
    }

    #[test]
    fn normalized_field_rejects_blank_values() {
        for value in ["", "   ", "\t\n"] {
            let error = normalized_field(value, "customer name").unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{value:?}");
        }
    }
}
