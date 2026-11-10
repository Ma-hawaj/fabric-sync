use chrono::{NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::{day_repository as storage, repository, service, till_repository, types::*};
use crate::{error::AppError, state::AppState};

// Every operation that changes a branch's financial report takes this lock.
// Closing never locks invoices, so invoice -> branch lock ordering cannot cycle.
pub(crate) async fn lock_branch(db: &mut PgConnection, branch: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("branch-business:{branch}"))
        .execute(db)
        .await?;
    Ok(())
}

pub(crate) async fn business_date(
    state: &AppState,
    db: &mut PgConnection,
) -> Result<NaiveDate, AppError> {
    let (started, now) = storage::transaction_times(db).await?;
    let zone = state.timezone()?;
    let day = started.with_timezone(&zone).date_naive();
    if day != now.with_timezone(&zone).date_naive() {
        return Err(AppError::Conflict(
            "The business date changed while saving. Refresh and try again.".into(),
        ));
    }
    Ok(day)
}

pub(crate) async fn transaction_time(
    db: &mut PgConnection,
) -> Result<chrono::DateTime<Utc>, AppError> {
    Ok(storage::transaction_times(db).await?.0)
}

pub(super) async fn editable(
    state: &AppState,
    db: &mut PgConnection,
    branch: Uuid,
    date: NaiveDate,
) -> Result<NaiveDate, AppError> {
    let today = business_date(state, db).await?;
    if date > today {
        return Err(AppError::BadRequest(
            "Future branch days cannot be changed or closed.".into(),
        ));
    }
    if date < today {
        return Err(AppError::Conflict("Past reports are read-only. A manager may separately resolve a missed closing without changing its figures.".into()));
    }
    let policy = super::rollout_repository::policy(db, branch)
        .await?
        .ok_or_else(|| {
            AppError::Conflict("A manager must set this branch's go-live date first.".into())
        })?;
    if date < policy.starts_on {
        return Err(AppError::Conflict(format!(
            "Closing controls start on {}. Earlier history is read-only.",
            policy.starts_on
        )));
    }
    if storage::closure(db, branch, date).await?.is_some() {
        return Err(AppError::Conflict(
            "This branch day is closed. Its report is read-only.".into(),
        ));
    }
    Ok(today)
}

pub async fn status(state: &AppState, branch: Uuid) -> Result<BranchDayStatus, AppError> {
    let mut tx = state.db().begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let today = business_date(state, &mut tx).await?;
    let result = load_status(state, &mut tx, branch, today).await?;
    tx.commit().await?;
    Ok(result)
}

async fn load_status(
    state: &AppState,
    db: &mut PgConnection,
    branch: Uuid,
    today: NaiveDate,
) -> Result<BranchDayStatus, AppError> {
    repository::branch_name(db, branch)
        .await?
        .ok_or_else(|| AppError::NotFound("Branch not found.".into()))?;
    let previous = storage::previous_unclosed(db, branch, state.timezone()?.name(), today).await?;
    let opening = till_repository::opening(db, branch, today, None)
        .await?
        .is_some();
    let closed = storage::closure(db, branch, today).await?.is_some();
    let starts = super::rollout_repository::policy(db, branch)
        .await?
        .map(|p| p.starts_on);
    Ok(BranchDayStatus {
        controls_start_date: starts,
        setup_required: starts.is_none(),
        branch_id: branch,
        date: today,
        opening_recorded: opening,
        closed,
        previous_unclosed_date: previous,
        can_create_orders: !closed
            && starts.is_some_and(|start| today < start || (opening && previous.is_none()))
            && storage::active_branch(db, branch).await?,
    })
}

/// Must run inside the financial write's transaction, after locking its invoice.
pub(crate) async fn require_trading(
    state: &AppState,
    db: &mut PgConnection,
    branch: Option<Uuid>,
) -> Result<NaiveDate, AppError> {
    let branch = branch.ok_or_else(|| {
        AppError::BadRequest("Choose an issuing branch before recording a sale or payment.".into())
    })?;
    lock_branch(db, branch).await?;
    let today = business_date(state, db).await?;
    let status = load_status(state, db, branch, today).await?;
    if status.closed {
        return Err(AppError::Conflict("This branch is closed for today. New orders and financial activity are blocked until the next business day.".into()));
    }
    let starts = status.controls_start_date.ok_or_else(|| {
        AppError::Conflict("A manager must set this branch's go-live date before trading.".into())
    })?;
    if today < starts {
        return Ok(today);
    }
    if let Some(previous) = status.previous_unclosed_date {
        return Err(AppError::Conflict(format!("A manager must resolve this branch's missed closing for {previous} before new orders or financial activity.")));
    }
    if !status.opening_recorded {
        return Err(AppError::Conflict("Record today's opening cash for this branch before recording new orders or financial activity.".into()));
    }
    Ok(today)
}

pub(crate) async fn require_new_orders(
    state: &AppState,
    db: &mut PgConnection,
    branch: Option<Uuid>,
) -> Result<(), AppError> {
    require_trading(state, db, branch).await?;
    if !storage::active_branch(db, branch.expect("validated branch")).await? {
        return Err(AppError::Conflict("This branch is inactive.".into()));
    }
    Ok(())
}

pub(crate) async fn require_invoice_trading(
    state: &AppState,
    db: &mut PgConnection,
    invoice: Uuid,
) -> Result<(), AppError> {
    let branch = storage::invoice_branch(db, invoice).await?;
    require_trading(state, db, branch).await?;
    Ok(())
}

pub async fn close_day(
    state: &AppState,
    input: CloseDayInput,
    actor: &str,
) -> Result<SalesClosing, AppError> {
    let hash = crate::idempotency::request_hash("branch.close.v1", input.branch_id, &input);
    let mut tx = state.db().begin().await?;
    lock_branch(&mut tx, input.branch_id).await?;
    if let Some(saved) = storage::closure(&mut tx, input.branch_id, input.date).await? {
        if saved.request_id != input.request_id {
            return Err(AppError::Conflict(
                "This branch day is already closed.".into(),
            ));
        }
        crate::idempotency::verify_request_hash(&saved.request_hash, &hash)?;
        return Ok(saved.into_report());
    }
    editable(state, &mut tx, input.branch_id, input.date).await?;
    if let Some(previous) = storage::previous_unclosed(
        &mut tx,
        input.branch_id,
        state.timezone()?.name(),
        input.date,
    )
    .await?
    {
        return Err(AppError::Conflict(format!(
            "Close the earlier active day {previous} first."
        )));
    }
    let check = repository::latest_check(&mut tx, input.branch_id, input.date)
        .await?
        .filter(|check| check.id == input.check_id && check.fingerprint == input.fingerprint)
        .ok_or_else(|| {
            AppError::Conflict("Save a current closing check before closing this day.".into())
        })?;
    let report = service::load(
        &mut tx,
        input.date,
        state.timezone()?,
        Utc::now(),
        input.branch_id,
    )
    .await?;
    if report.fingerprint != check.fingerprint {
        return Err(AppError::Conflict(
            "Recorded transactions changed. Refresh and save a new check before closing.".into(),
        ));
    }
    // Revalidate stored counts. An explained difference is allowed and retained.
    super::reconciliation::compare(&report, &check.counts)?;
    if !check.comparison.matched && check.counts.notes.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Explain the difference or unresolved activity before closing.".into(),
        ));
    }
    storage::insert_closure(&mut tx, &input, &hash, actor).await?;
    let result = storage::closure(&mut tx, input.branch_id, input.date)
        .await?
        .expect("new closure exists")
        .into_report();
    tx.commit().await?;
    Ok(result)
}
