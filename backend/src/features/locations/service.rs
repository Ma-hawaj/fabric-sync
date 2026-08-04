use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{CreateLocationInput, Location, UpdateLocationInput},
};

fn normalized_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();

    if name.is_empty() {
        return Err(AppError::BadRequest(
            "location name cannot be empty".to_string(),
        ));
    }

    Ok(name.to_string())
}

// A location that neither takes customer orders nor holds stock can't be
// picked anywhere, so it is rejected rather than silently created unusable.
fn validate_capabilities(receives_orders: bool, holds_stock: bool) -> Result<(), AppError> {
    if !receives_orders && !holds_stock {
        return Err(AppError::BadRequest(
            "a location must either receive orders or hold stock".to_string(),
        ));
    }

    Ok(())
}

pub async fn list_locations(state: &AppState) -> Result<Vec<Location>, AppError> {
    Ok(repository::list_locations(state).await?)
}

pub async fn create_location(
    state: &AppState,
    input: CreateLocationInput,
) -> Result<Location, AppError> {
    let name = normalized_name(&input.name)?;
    validate_capabilities(input.receives_orders, input.holds_stock)?;

    let location =
        repository::create_location(state, &name, input.receives_orders, input.holds_stock).await?;

    tracing::info!(location_id = %location.id, name = %location.name, "location created");

    Ok(location)
}

pub async fn update_location(
    state: &AppState,
    location_id: Uuid,
    input: UpdateLocationInput,
) -> Result<Location, AppError> {
    let name = input.name.as_deref().map(normalized_name).transpose()?;

    // Only checkable when the request sets both flags; a partial update that
    // touches one of them can't know the stored value of the other.
    if let (Some(receives_orders), Some(holds_stock)) = (input.receives_orders, input.holds_stock) {
        validate_capabilities(receives_orders, holds_stock)?;
    }

    let location = repository::update_location(
        state,
        location_id,
        name.as_deref(),
        input.receives_orders,
        input.holds_stock,
        input.is_active,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("location {location_id} not found")))?;

    tracing::info!(
        location_id = %location_id,
        is_active = ?input.is_active,
        receives_orders = ?input.receives_orders,
        holds_stock = ?input.holds_stock,
        "location updated"
    );

    Ok(location)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_name_trims_surrounding_whitespace() {
        assert_eq!(
            normalized_name("  Downtown Branch \n").unwrap(),
            "Downtown Branch"
        );
    }

    #[test]
    fn normalized_name_rejects_blank_names() {
        for name in ["", "   ", "\t\n"] {
            let error = normalized_name(name).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{name:?}");
        }
    }

    #[test]
    fn validate_capabilities_accepts_any_single_capability() {
        assert!(validate_capabilities(true, false).is_ok());
        assert!(validate_capabilities(false, true).is_ok());
        assert!(validate_capabilities(true, true).is_ok());
    }

    #[test]
    fn validate_capabilities_rejects_a_location_that_does_neither() {
        let error = validate_capabilities(false, false).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }
}
