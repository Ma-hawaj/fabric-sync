use chrono::{NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::{
    day_repository, day_service, missed_repository as storage, service, till_repository, types::*,
};
use crate::{
    error::AppError,
    idempotency::{request_hash, verify_request_hash},
    state::AppState,
};

/// Called under the branch lock. Skipping supplies no physical counts and never
/// replaces an existing closing or missed-day snapshot.
pub(super) async fn auto_skip(
    state: &AppState,
    db: &mut PgConnection,
    branch: Uuid,
    today: NaiveDate,
    actor: &str,
) -> Result<(), AppError> {
    let zone = state.timezone()?;
    while let Some(date) = day_repository::previous_unclosed(db, branch, zone.name(), today).await?
    {
        let input = ResolveMissedClosingInput {
            request_id: Uuid::new_v4(),
            branch_id: branch,
            date,
            reason: "Automatically skipped because the daily trading check was disabled. Physical counts were not recorded.".into(),
        };
        let hash = request_hash("branch.closing.missed.v1", branch, &input);
        let mut report = service::load(db, date, zone, Utc::now(), branch).await?;
        report.business_date = Some(today);
        report.read_only = true;
        storage::insert_missed(db, &input, &hash, actor, &report).await?;
    }
    Ok(())
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
    let start = till_repository::tracking_start(&mut tx, input.branch_id)
        .await?
        .ok_or_else(|| {
            AppError::BadRequest(
                "Tracking starts with the first opening. Earlier history does not need skipping."
                    .into(),
            )
        })?;
    if input.date < start {
        return Err(AppError::BadRequest(
            "History before the first opening does not require skipping.".into(),
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
