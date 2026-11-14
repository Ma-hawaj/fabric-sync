use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{AssignFinancialBranchInput, FinancialBranch},
};

pub async fn assign(
    state: &AppState,
    invoice: Uuid,
    mut input: AssignFinancialBranchInput,
    actor: &str,
) -> Result<FinancialBranch, AppError> {
    input.reason = input.reason.trim().to_string();
    if input.reason.is_empty() || input.reason.chars().count() > 1000 {
        return Err(AppError::BadRequest(
            "Enter a reason of 1–1000 characters for assigning the financial branch.".into(),
        ));
    }
    if actor.trim().is_empty() {
        return Err(AppError::Unauthorized(
            "A staff identity is required to assign a financial branch.".into(),
        ));
    }
    let mut tx = state.db().begin().await?;
    let locked = repository::lock_invoice(&mut tx, invoice)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found.".into()))?;
    let saved = repository::financial_branch(&mut tx, invoice).await?;
    if saved.request_id == Some(input.request_id) {
        if saved.branch_id == Some(input.branch_id)
            && saved.reason.as_deref() == Some(input.reason.as_str())
        {
            return Ok(saved);
        }
        return Err(AppError::Conflict(
            "This assignment request was already used with different values.".into(),
        ));
    }
    if locked.issuing_branch_id.or(locked.branch_id).is_some() {
        return Err(AppError::Conflict(
            "This invoice already has a financial branch. It cannot be reassigned.".into(),
        ));
    }
    // Invoice -> branch is the same lock order as payments and closing guards.
    crate::features::reports::day_service::require_new_orders(
        state,
        &mut tx,
        Some(input.branch_id),
    )
    .await?;
    repository::assign_financial_branch(&mut tx, invoice, &input, actor).await?;
    let result = repository::financial_branch(&mut tx, invoice).await?;
    tx.commit().await?;
    Ok(result)
}
