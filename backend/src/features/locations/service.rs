use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

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

// A location needs at least one independently configured capability.
fn validate_capabilities(
    receives_orders: bool,
    holds_stock: bool,
    produces_orders: bool,
) -> Result<(), AppError> {
    if !receives_orders && !holds_stock && !produces_orders {
        return Err(AppError::BadRequest(
            "a location must receive orders, hold stock, or produce orders".to_string(),
        ));
    }

    Ok(())
}

pub async fn list_locations(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Location>, AppError> {
    repository::list_locations(state, params).await
}

pub async fn get_location(state: &AppState, location_id: Uuid) -> Result<Location, AppError> {
    repository::get_location(state, location_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("location {location_id} not found")))
}

pub async fn create_location(
    state: &AppState,
    input: CreateLocationInput,
) -> Result<Location, AppError> {
    let name = normalized_name(&input.name)?;
    validate_capabilities(
        input.receives_orders,
        input.holds_stock,
        input.produces_orders,
    )?;

    let location = repository::create_location(
        state,
        &name,
        input.receives_orders,
        input.holds_stock,
        input.produces_orders,
    )
    .await?;

    tracing::info!(location_id = %location.id, name = %location.name, "location created");

    Ok(location)
}

pub async fn update_location(
    state: &AppState,
    location_id: Uuid,
    input: UpdateLocationInput,
) -> Result<Location, AppError> {
    let name = input.name.as_deref().map(normalized_name).transpose()?;

    let current = get_location(state, location_id).await?;
    validate_capabilities(
        input.receives_orders.unwrap_or(current.receives_orders),
        input.holds_stock.unwrap_or(current.holds_stock),
        input.produces_orders.unwrap_or(current.produces_orders),
    )?;

    let location = repository::update_location(
        state,
        location_id,
        name.as_deref(),
        input.receives_orders,
        input.holds_stock,
        input.produces_orders,
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
        assert!(validate_capabilities(false, false, true).is_ok());
        assert!(validate_capabilities(true, false, false).is_ok());
        assert!(validate_capabilities(false, true, false).is_ok());
        assert!(validate_capabilities(true, true, true).is_ok());
    }

    #[test]
    fn validate_capabilities_rejects_a_location_that_does_neither() {
        let error = validate_capabilities(false, false, false).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[sqlx::test]
    async fn production_only_locations_survive_partial_updates(db: sqlx::PgPool) {
        let state = crate::test_support::state(db, None, None).await;
        let location = create_location(
            &state,
            serde_json::from_value(serde_json::json!({
                "name":"Workshop", "receivesOrders":false, "holdsStock":false, "producesOrders":true
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert!(location.produces_orders);
        assert!(!location.holds_stock);
        let updated = update_location(
            &state,
            location.id,
            serde_json::from_value(serde_json::json!({"name":"Renamed workshop"})).unwrap(),
        )
        .await
        .unwrap();
        assert!(updated.produces_orders);
        assert!(matches!(
            update_location(
                &state,
                location.id,
                serde_json::from_value(serde_json::json!({"producesOrders":false})).unwrap()
            )
            .await,
            Err(AppError::BadRequest(_))
        ));
    }
}
