use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{
        AddStockInput, CreateMaterialInput, Material, MaterialPrices, StockEntryInput,
        TransferStockInput, UpdateMaterialInput,
    },
};

pub async fn list_materials(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Material>, AppError> {
    repository::list_materials(state, params).await
}

pub async fn get_material(state: &AppState, material_id: Uuid) -> Result<Material, AppError> {
    repository::get_material(state, material_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("material {material_id} not found")))
}

pub async fn create_material(
    state: &AppState,
    input: CreateMaterialInput,
) -> Result<Material, AppError> {
    validate_prices(&input.prices)?;
    let material_id = repository::create_material(
        state,
        &input.name,
        input.sku.as_deref(),
        &input.unit,
        input.family.as_deref(),
        &input.prices,
        &input.entries,
    )
    .await?;

    tracing::info!(material_id = %material_id, name = %input.name, "material created");

    Ok(repository::get_material(state, material_id)
        .await?
        .expect("material was just created"))
}

fn validate_prices(prices: &MaterialPrices) -> Result<(), AppError> {
    for value in [prices.junior_price, prices.normal_price, prices.large_price] {
        crate::features::pricing::service::validate_amount(value)?;
    }
    Ok(())
}

pub async fn update_material(
    state: &AppState,
    id: Uuid,
    mut input: UpdateMaterialInput,
) -> Result<Material, AppError> {
    validate_prices(&input.prices)?;
    input.name = input.name.trim().to_string();
    input.unit = input.unit.trim().to_string();
    if input.name.is_empty() || input.unit.is_empty() {
        return Err(AppError::BadRequest(
            "material name and unit cannot be empty".into(),
        ));
    }
    input.sku = input
        .sku
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    input.family = input
        .family
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if !repository::update_material(state, id, &input).await? {
        return Err(AppError::NotFound(format!("material {id} not found")));
    }
    get_material(state, id).await
}

fn validate_transfer(input: &TransferStockInput) -> Result<(), AppError> {
    if input.from_location_id == input.to_location_id {
        return Err(AppError::BadRequest(
            "pick different source and destination locations".into(),
        ));
    }
    if input.quantity < 0.01
        || crate::features::pricing::service::validate_amount(input.quantity).is_err()
    {
        return Err(AppError::BadRequest(
            "move a quantity of at least 0.01 with at most two decimal places".into(),
        ));
    }
    Ok(())
}

pub async fn transfer_stock(
    state: &AppState,
    id: Uuid,
    input: TransferStockInput,
) -> Result<Material, AppError> {
    validate_transfer(&input)?;
    use repository::TransferResult;
    match repository::transfer_stock(state.db(), id, &input).await? {
        TransferResult::MissingMaterial => {
            return Err(AppError::NotFound(format!("material {id} not found")))
        }
        TransferResult::InvalidDestination => {
            return Err(AppError::BadRequest(
                "pick an active destination that holds stock".into(),
            ))
        }
        TransferResult::InsufficientStock => {
            return Err(AppError::BadRequest(
                "not enough material at the source location".into(),
            ))
        }
        TransferResult::Transferred => {}
    }
    tracing::info!(material_id = %id, from = %input.from_location_id, to = %input.to_location_id, quantity = input.quantity, "material stock moved");
    get_material(state, id).await
}

pub async fn add_stock(
    state: &AppState,
    material_id: Uuid,
    input: AddStockInput,
) -> Result<Material, AppError> {
    if repository::get_material(state, material_id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound(format!(
            "material {material_id} not found"
        )));
    }

    repository::add_stock(state, material_id, &input.entries).await?;

    let total_added: f64 = input.entries.iter().map(|entry| entry.quantity).sum();
    tracing::info!(
        material_id = %material_id,
        locations = input.entries.len(),
        quantity_added = total_added,
        "material stock added"
    );

    Ok(repository::get_material(state, material_id)
        .await?
        .expect("material was just confirmed to exist"))
}

// Taking stock off has to name a positive amount — zero removes nothing and
// a negative amount would add stock through the back door. Pure, so it can
// be tested without a database.
fn validate_removal(entries: &[StockEntryInput]) -> Result<(), AppError> {
    if entries.iter().any(|entry| entry.quantity <= 0.0) {
        return Err(AppError::BadRequest(
            "a removal quantity has to be greater than zero".to_string(),
        ));
    }

    Ok(())
}

/// Takes stock off a material without deleting it — wastage, samples, or a
/// correction. Guarded per location in the repository, so removing more than
/// a location holds is refused rather than driving it negative.
pub async fn remove_stock(
    state: &AppState,
    material_id: Uuid,
    input: AddStockInput,
) -> Result<Material, AppError> {
    let material = repository::get_material(state, material_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("material {material_id} not found")))?;

    validate_removal(&input.entries)?;

    let refused = repository::remove_stock(state, material_id, &input.entries).await?;

    if let Some(branch_id) = refused.first() {
        let location = material
            .locations
            .iter()
            .find(|stock| stock.location_id == *branch_id)
            .map(|stock| stock.location.as_str())
            .unwrap_or("the selected location");
        return Err(AppError::BadRequest(format!(
            "not enough {} in stock at {location}",
            material.name,
        )));
    }

    let total_removed: f64 = input.entries.iter().map(|entry| entry.quantity).sum();
    tracing::info!(
        material_id = %material_id,
        locations = input.entries.len(),
        quantity_removed = total_removed,
        "material stock removed"
    );

    Ok(repository::get_material(state, material_id)
        .await?
        .expect("material was just confirmed to exist"))
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
    fn validate_removal_rejects_a_non_positive_quantity() {
        assert!(validate_removal(&entries(&[0.5, 12.0])).is_ok());
        for quantity in [0.0, -1.0] {
            let error = validate_removal(&entries(&[3.0, quantity])).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{quantity}");
        }
    }
}

#[cfg(test)]
mod transfer_tests {
    use super::*;
    #[test]
    fn transfer_requires_distinct_locations_and_a_positive_storable_quantity() {
        let from = Uuid::new_v4();
        let to = Uuid::new_v4();
        for quantity in [0.0, -1.0, 0.001, 1.001, f64::NAN, f64::INFINITY] {
            assert!(validate_transfer(&TransferStockInput {
                from_location_id: from,
                to_location_id: to,
                quantity
            })
            .is_err());
        }
        assert!(validate_transfer(&TransferStockInput {
            from_location_id: from,
            to_location_id: from,
            quantity: 1.0
        })
        .is_err());
        assert!(validate_transfer(&TransferStockInput {
            from_location_id: from,
            to_location_id: to,
            quantity: 0.01
        })
        .is_ok());
    }
}
