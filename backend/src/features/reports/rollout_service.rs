use chrono::Utc;

use super::{
    day_repository, day_service, repository, rollout_repository as storage, service, types::*,
};
use crate::{
    error::AppError,
    idempotency::{request_hash, verify_request_hash},
    state::AppState,
};

pub async fn configure(
    state: &AppState,
    input: ConfigureClosingInput,
    actor: &str,
) -> Result<ClosingPolicy, AppError> {
    let hash = request_hash("branch.closing.policy.v1", input.branch_id, &input);
    let mut tx = state.db().begin().await?;
    day_service::lock_branch(&mut tx, input.branch_id).await?;
    if let Some(saved) = storage::policy(&mut tx, input.branch_id).await? {
        if saved.request_id == input.request_id {
            verify_request_hash(&saved.request_hash, &hash)?;
            return Ok(saved.into_policy());
        }
        return Err(AppError::Conflict(
            "The go-live date is already set and cannot be changed.".into(),
        ));
    }
    repository::branch_name(&mut tx, input.branch_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Branch not found.".into()))?;
    let today = day_service::business_date(state, &mut tx).await?;
    if input.starts_on < today {
        return Err(AppError::BadRequest("Choose today or a future go-live date. History cannot be backdated into closing controls.".into()));
    }
    if input.starts_on == today {
        let report = service::load(
            &mut tx,
            today,
            state.timezone()?,
            Utc::now(),
            input.branch_id,
        )
        .await?;
        if !report.activity.is_empty()
            || report.opening.is_some()
            || !report.expenses.is_empty()
            || day_repository::closure(&mut tx, input.branch_id, today)
                .await?
                .is_some()
        {
            return Err(AppError::BadRequest("This branch already has activity today. Choose a future go-live date so its first opening cash is counted before trading.".into()));
        }
    }
    storage::insert_policy(&mut tx, &input, &hash, actor).await?;
    let saved = storage::policy(&mut tx, input.branch_id)
        .await?
        .expect("new policy exists")
        .into_policy();
    tx.commit().await?;
    Ok(saved)
}

pub async fn resolve_missed(
    state: &AppState,
    input: ResolveMissedClosingInput,
    actor: &str,
) -> Result<SalesClosing, AppError> {
    if input.reason.trim().is_empty() || input.reason.chars().count() > 2000 {
        return Err(AppError::BadRequest(
            "Explain the missed closing in 1–2,000 characters.".into(),
        ));
    }
    let hash = request_hash("branch.closing.missed.v1", input.branch_id, &input);
    let mut tx = state.db().begin().await?;
    day_service::lock_branch(&mut tx, input.branch_id).await?;
    if let Some(saved) = storage::missed(&mut tx, input.branch_id, input.date).await? {
        if saved.request_id == input.request_id {
            verify_request_hash(&saved.request_hash, &hash)?;
            return Ok(saved.into_report());
        }
        return Err(AppError::Conflict(
            "This missed closing is already resolved and is read-only.".into(),
        ));
    }
    let today = day_service::business_date(state, &mut tx).await?;
    if input.date >= today {
        return Err(AppError::BadRequest("Only a past missed closing can be resolved. Use the normal closing workflow for today.".into()));
    }
    let policy = storage::policy(&mut tx, input.branch_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("Set the branch go-live date first.".into()))?;
    if input.date < policy.starts_on {
        return Err(AppError::BadRequest(
            "History before go-live does not require a closing resolution.".into(),
        ));
    }
    if day_repository::closure(&mut tx, input.branch_id, input.date)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict(
            "This day is already closed. Its report cannot be changed or reopened.".into(),
        ));
    }
    if day_repository::previous_unclosed(&mut tx, input.branch_id, state.timezone()?.name(), today)
        .await?
        != Some(input.date)
    {
        return Err(AppError::Conflict(
            "Resolve the earliest outstanding active day first.".into(),
        ));
    }
    let mut report = service::load(
        &mut tx,
        input.date,
        state.timezone()?,
        Utc::now(),
        input.branch_id,
    )
    .await?;
    report.policy = Some(policy.into_policy());
    report.business_date = Some(today);
    report.read_only = true;
    storage::insert_missed(&mut tx, &input, &hash, actor, &report).await?;
    let saved = storage::missed(&mut tx, input.branch_id, input.date)
        .await?
        .expect("new missed closing exists")
        .into_report();
    tx.commit().await?;
    Ok(saved)
}
