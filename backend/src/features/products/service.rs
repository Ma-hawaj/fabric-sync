use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{AddStockInput, CreateProductInput, Product, StockEntryInput, UpdateProductInput},
};

fn normalized_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();

    if name.is_empty() {
        return Err(AppError::BadRequest(
            "product name cannot be empty".to_string(),
        ));
    }

    Ok(name.to_string())
}

// On create a blank SKU means "none given", so it is stored as NULL — the
// column is UNIQUE and Postgres allows repeated NULLs but not repeated ''.
fn created_sku(sku: Option<&str>) -> Option<String> {
    sku.map(str::trim)
        .filter(|sku| !sku.is_empty())
        .map(str::to_string)
}

// On update the same blank means "clear the stored one", which the repository
// distinguishes from an omitted field by the empty string.
fn updated_sku(sku: Option<&str>) -> Option<String> {
    sku.map(|sku| sku.trim().to_string())
}

fn validate_unit_price(unit_price: f64) -> Result<(), AppError> {
    if unit_price < 0.0 {
        return Err(AppError::BadRequest(
            "a product price cannot be negative".to_string(),
        ));
    }

    Ok(())
}

fn validate_entries(entries: &[StockEntryInput]) -> Result<(), AppError> {
    if entries.iter().any(|entry| entry.quantity < 0.0) {
        return Err(AppError::BadRequest(
            "a stock quantity cannot be negative".to_string(),
        ));
    }

    Ok(())
}

pub async fn list_products(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Product>, AppError> {
    repository::list_products(state, params).await
}

pub async fn create_product(
    state: &AppState,
    input: CreateProductInput,
) -> Result<Product, AppError> {
    let name = normalized_name(&input.name)?;
    let sku = created_sku(input.sku.as_deref());
    validate_unit_price(input.unit_price)?;
    validate_entries(&input.entries)?;

    let product_id = repository::create_product(
        state,
        &name,
        sku.as_deref(),
        input.unit_price,
        &input.entries,
    )
    .await?;

    tracing::info!(product_id = %product_id, name = %name, unit_price = input.unit_price, "product created");

    Ok(repository::get_product(state, product_id)
        .await?
        .expect("product was just created"))
}

pub async fn update_product(
    state: &AppState,
    product_id: Uuid,
    input: UpdateProductInput,
) -> Result<Product, AppError> {
    let name = input.name.as_deref().map(normalized_name).transpose()?;
    let sku = updated_sku(input.sku.as_deref());

    if let Some(unit_price) = input.unit_price {
        validate_unit_price(unit_price)?;
    }

    repository::update_product(
        state,
        product_id,
        name.as_deref(),
        sku.as_deref(),
        input.unit_price,
        input.is_active,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("product {product_id} not found")))?;

    tracing::info!(
        product_id = %product_id,
        is_active = ?input.is_active,
        unit_price = ?input.unit_price,
        "product updated"
    );

    Ok(repository::get_product(state, product_id)
        .await?
        .expect("product was just updated"))
}

pub async fn add_stock(
    state: &AppState,
    product_id: Uuid,
    input: AddStockInput,
) -> Result<Product, AppError> {
    if repository::get_product(state, product_id).await?.is_none() {
        return Err(AppError::NotFound(format!(
            "product {product_id} not found"
        )));
    }

    validate_entries(&input.entries)?;

    repository::add_stock(state, product_id, &input.entries).await?;

    let total_added: f64 = input.entries.iter().map(|entry| entry.quantity).sum();
    tracing::info!(
        product_id = %product_id,
        locations = input.entries.len(),
        quantity_added = total_added,
        "product stock added"
    );

    Ok(repository::get_product(state, product_id)
        .await?
        .expect("product was just confirmed to exist"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(quantities: &[f64]) -> Vec<StockEntryInput> {
        quantities
            .iter()
            .map(|quantity| StockEntryInput {
                location_id: Uuid::nil(),
                quantity: *quantity,
            })
            .collect()
    }

    #[test]
    fn normalized_name_trims_surrounding_whitespace() {
        assert_eq!(normalized_name("  Silk Scarf \n").unwrap(), "Silk Scarf");
    }

    #[test]
    fn normalized_name_rejects_blank_names() {
        for name in ["", "   ", "\t\n"] {
            let error = normalized_name(name).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{name:?}");
        }
    }

    #[test]
    fn a_blank_sku_is_stored_as_null_on_create() {
        assert_eq!(created_sku(Some("   ")), None);
        assert_eq!(created_sku(None), None);
        assert_eq!(created_sku(Some(" SC-1 ")), Some("SC-1".to_string()));
    }

    #[test]
    fn a_blank_sku_clears_the_stored_one_on_update() {
        assert_eq!(updated_sku(Some("   ")), Some(String::new()));
        assert_eq!(updated_sku(None), None);
        assert_eq!(updated_sku(Some(" SC-1 ")), Some("SC-1".to_string()));
    }

    #[test]
    fn validate_unit_price_rejects_a_negative_price() {
        assert!(validate_unit_price(0.0).is_ok());
        assert!(validate_unit_price(49.5).is_ok());
        let error = validate_unit_price(-1.0).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn validate_entries_rejects_a_negative_quantity() {
        assert!(validate_entries(&entries(&[0.0, 12.0])).is_ok());
        let error = validate_entries(&entries(&[3.0, -1.0])).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }
}
