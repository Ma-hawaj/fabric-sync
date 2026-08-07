use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{CreateOrderStageInput, OrderStage, UpdateOrderStageInput},
};

fn normalized_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();

    if name.is_empty() {
        return Err(AppError::BadRequest(
            "stage name cannot be empty".to_string(),
        ));
    }

    Ok(name.to_string())
}

// Positions are 1-based so the number shown next to a stage reads as "first",
// "second", and so on. Gaps are fine — only the relative order is used.
fn validate_sort_order(sort_order: i32) -> Result<(), AppError> {
    if sort_order < 1 {
        return Err(AppError::BadRequest(
            "a stage position must be 1 or more".to_string(),
        ));
    }

    Ok(())
}

pub async fn list_stages(state: &AppState) -> Result<Vec<OrderStage>, AppError> {
    Ok(repository::list_stages(state).await?)
}

pub async fn create_stage(
    state: &AppState,
    input: CreateOrderStageInput,
) -> Result<OrderStage, AppError> {
    let name = normalized_name(&input.name)?;
    validate_sort_order(input.sort_order)?;

    let stage =
        repository::create_stage(state, &name, input.sort_order, input.requires_delivery).await?;

    tracing::info!(stage_id = %stage.id, name = %stage.name, "order stage catalog entry created");

    Ok(stage)
}

pub async fn update_stage(
    state: &AppState,
    stage_id: Uuid,
    input: UpdateOrderStageInput,
) -> Result<OrderStage, AppError> {
    let name = input.name.as_deref().map(normalized_name).transpose()?;

    if let Some(sort_order) = input.sort_order {
        validate_sort_order(sort_order)?;
    }

    let stage = repository::update_stage(
        state,
        stage_id,
        name.as_deref(),
        input.sort_order,
        input.requires_delivery,
        input.is_active,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("order stage {stage_id} not found")))?;

    tracing::info!(
        stage_id = %stage_id,
        is_active = ?input.is_active,
        sort_order = ?input.sort_order,
        "order stage catalog entry updated"
    );

    Ok(stage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_name_trims_surrounding_whitespace() {
        assert_eq!(normalized_name("  Cutting \n").unwrap(), "Cutting");
    }

    #[test]
    fn normalized_name_rejects_blank_names() {
        for name in ["", "   ", "\t\n"] {
            let error = normalized_name(name).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{name:?}");
        }
    }

    #[test]
    fn validate_sort_order_accepts_any_position_from_one_up() {
        assert!(validate_sort_order(1).is_ok());
        assert!(validate_sort_order(40).is_ok());
    }

    #[test]
    fn validate_sort_order_rejects_zero_and_negatives() {
        for sort_order in [0, -1, -12] {
            let error = validate_sort_order(sort_order).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{sort_order}");
        }
    }
}
