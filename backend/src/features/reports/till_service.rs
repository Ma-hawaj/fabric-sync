use chrono::NaiveDate;
use sqlx::PgConnection;
use uuid::Uuid;

use super::{reconciliation::fils, repository, till_repository as storage, types::*};
use crate::{
    error::AppError,
    idempotency::{request_hash, verify_request_hash},
    state::AppState,
};

fn reason(value: &str, maximum: usize) -> Result<(), AppError> {
    if value.trim().is_empty() || value.chars().count() > maximum {
        return Err(AppError::BadRequest(format!(
            "Enter a reason with 1–{maximum} characters."
        )));
    }
    Ok(())
}

async fn validate_day(
    state: &AppState,
    db: &mut PgConnection,
    branch: Uuid,
    date: NaiveDate,
) -> Result<(), AppError> {
    repository::branch_name(db, branch)
        .await?
        .ok_or_else(|| AppError::NotFound("Branch not found.".into()))?;
    super::day_service::editable(state, db, branch, date).await?;
    Ok(())
}

pub async fn save_opening(
    state: &AppState,
    input: SaveOpeningInput,
    previous: Option<Uuid>,
    actor: &str,
) -> Result<CashOpening, AppError> {
    fils(input.amount, false)?;
    if input.notes.chars().count() > 2000 {
        return Err(AppError::BadRequest(
            "Keep opening notes within 2,000 characters.".into(),
        ));
    }
    if previous.is_some() {
        reason(&input.notes, 2000)?;
    }
    let hash = request_hash(
        "branch.opening.v1",
        previous.unwrap_or(input.branch_id),
        &input,
    );
    let mut tx = state.db().begin().await?;
    super::day_service::lock_branch(&mut tx, input.branch_id).await?;
    if let Some(replay) =
        storage::opening(&mut tx, input.branch_id, input.date, Some(input.request_id)).await?
    {
        verify_request_hash(&replay.request_hash, &hash)?;
        return Ok(replay.into_opening());
    }
    validate_day(state, &mut tx, input.branch_id, input.date).await?;
    let current = storage::opening(&mut tx, input.branch_id, input.date, None).await?;
    if let Some(day) = super::day_repository::previous_unclosed(
        &mut tx,
        input.branch_id,
        state.timezone()?.name(),
        input.date,
    )
    .await?
    {
        return Err(AppError::Conflict(format!(
            "A manager must resolve the missed closing for {day} before opening today."
        )));
    }
    if previous.is_some() {
        if current.as_ref().map(|o| o.id) != previous {
            return Err(AppError::Conflict(
                "Opening cash changed. Refresh before correcting it.".into(),
            ));
        }
    } else {
        if current.is_some() {
            return Err(AppError::Conflict(
                "Opening cash is already saved. A manager must record any correction.".into(),
            ));
        }
        if repository::latest_check(&mut tx, input.branch_id, input.date)
            .await?
            .is_some()
        {
            return Err(AppError::Conflict("This day already has a closing check. Its opening cash cannot be entered afterward.".into()));
        }
    }
    let opening = storage::insert_opening(&mut tx, &input, &hash, actor, previous).await?;
    tx.commit().await?;
    Ok(opening)
}

pub async fn record_expense(
    state: &AppState,
    input: RecordExpenseInput,
    actor: &str,
) -> Result<BranchExpense, AppError> {
    if fils(input.amount, false)? <= 0 {
        return Err(AppError::BadRequest(
            "Enter an expense amount greater than zero.".into(),
        ));
    }
    reason(&input.reason, 1000)?;
    if input.paid_to.chars().count() > 200 || input.reference.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "Keep payee and receipt reference within 200 characters each.".into(),
        ));
    }
    let hash = request_hash("branch.expense.v1", input.branch_id, &input);
    let mut tx = state.db().begin().await?;
    super::day_service::lock_branch(&mut tx, input.branch_id).await?;
    if let Some(replay) = storage::expenses(&mut tx, None, None, Some(input.request_id), None)
        .await?
        .pop()
    {
        verify_request_hash(&replay.request_hash, &hash)?;
        return Ok(replay.into_expense());
    }
    validate_day(state, &mut tx, input.branch_id, input.date).await?;
    super::day_service::require_trading(state, &mut tx, Some(input.branch_id)).await?;
    let id = storage::insert_expense(&mut tx, &input, &hash, actor).await?;
    let expense = storage::expenses(&mut tx, None, None, None, Some(id))
        .await?
        .pop()
        .expect("new expense exists")
        .into_expense();
    tx.commit().await?;
    Ok(expense)
}

pub async fn void_expense(
    state: &AppState,
    id: Uuid,
    input: VoidExpenseInput,
    actor: &str,
) -> Result<BranchExpense, AppError> {
    reason(&input.reason, 1000)?;
    let hash = request_hash("branch.expense.void.v1", id, &input);
    let mut tx = state.db().begin().await?;
    let expense = storage::expenses(&mut tx, None, None, None, Some(id))
        .await?
        .pop()
        .ok_or_else(|| AppError::NotFound("Expense not found.".into()))?;
    super::day_service::lock_branch(&mut tx, expense.branch_id).await?;
    let expense = storage::expenses(&mut tx, None, None, None, Some(id))
        .await?
        .pop()
        .expect("expense remains recorded");
    if expense.voided_at.is_some() {
        if expense.void_request_id == Some(input.request_id) {
            verify_request_hash(
                expense.void_request_hash.as_deref().unwrap_or_default(),
                &hash,
            )?;
            return Ok(expense.into_expense());
        }
        return Err(AppError::Conflict("This expense is already voided.".into()));
    }
    validate_day(state, &mut tx, expense.branch_id, expense.business_date).await?;
    super::day_service::require_trading(state, &mut tx, Some(expense.branch_id)).await?;
    storage::insert_void(&mut tx, id, &input, &hash, actor).await?;
    let expense = storage::expenses(&mut tx, None, None, None, Some(id))
        .await?
        .pop()
        .expect("voided expense remains recorded")
        .into_expense();
    tx.commit().await?;
    Ok(expense)
}
