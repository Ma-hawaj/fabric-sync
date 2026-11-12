use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::types::*;

pub struct DailyCheckSettings {
    pub required: bool,
    pub changed_at: Option<DateTime<Utc>>,
    pub changed_by: Option<String>,
}

pub async fn daily_check_settings(
    db: &mut PgConnection,
    branch: Uuid,
) -> Result<DailyCheckSettings, sqlx::Error> {
    sqlx::query_as!(DailyCheckSettings,
        "SELECT daily_check_required AS required, daily_check_changed_at AS changed_at, daily_check_changed_by AS changed_by FROM branch WHERE id=$1", branch)
        .fetch_one(db).await
}

pub async fn update_daily_check(
    db: &mut PgConnection,
    branch: Uuid,
    required: bool,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!("UPDATE branch SET daily_check_required=$2, daily_check_changed_at=clock_timestamp(), daily_check_changed_by=$3 WHERE id=$1 AND daily_check_required IS DISTINCT FROM $2",branch,required,actor)
        .execute(db).await?;
    Ok(())
}

pub async fn transaction_times(
    db: &mut PgConnection,
) -> Result<(DateTime<Utc>, DateTime<Utc>), sqlx::Error> {
    let times = sqlx::query!(
        "SELECT transaction_timestamp() AS \"started!\", clock_timestamp() AS \"now!\""
    )
    .fetch_one(db)
    .await?;
    Ok((times.started, times.now))
}

pub async fn active_branch(db: &mut PgConnection, branch: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!("SELECT is_active FROM branch WHERE id = $1", branch)
        .fetch_one(db)
        .await
}

pub async fn invoice_branch(
    db: &mut PgConnection,
    invoice: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT COALESCE(issuing_branch_id, branch_id) FROM invoices WHERE id = $1",
        invoice
    )
    .fetch_one(db)
    .await
}

pub struct ActiveDays {
    pub previous_unclosed_date: Option<NaiveDate>,
    pub previous_active_date: Option<NaiveDate>,
    pub has_activity_today: bool,
}

pub async fn active_days(
    db: &mut PgConnection,
    branch: Uuid,
    zone: &str,
    before: NaiveDate,
) -> Result<ActiveDays, sqlx::Error> {
    sqlx::query_file_as!(
        ActiveDays,
        "src/features/reports/sql/active_days.sql",
        branch,
        zone,
        before
    )
    .fetch_one(db)
    .await
}

pub async fn previous_unclosed(
    db: &mut PgConnection,
    branch: Uuid,
    zone: &str,
    before: NaiveDate,
) -> Result<Option<NaiveDate>, sqlx::Error> {
    Ok(active_days(db, branch, zone, before)
        .await?
        .previous_unclosed_date)
}

pub struct ClosureRow {
    pub id: Uuid,
    pub closed_at: DateTime<Utc>,
    pub closed_by: String,
    pub request_id: Uuid,
    pub request_hash: Vec<u8>,
    pub snapshot: sqlx::types::Json<SalesClosing>,
    pub counts: sqlx::types::Json<ClosingCounts>,
    pub comparison: sqlx::types::Json<Comparison>,
}
impl ClosureRow {
    pub fn into_report(self) -> SalesClosing {
        let mut report = self.snapshot.0;
        report.closure = Some(DayClosure {
            late: report.business_date.is_some_and(|day| day > report.date),
            id: self.id,
            closed_at: self.closed_at,
            closed_by: self.closed_by,
            counts: self.counts.0,
            comparison: self.comparison.0,
        });
        report.read_only = true;
        report
    }
}
pub async fn closure(
    db: &mut PgConnection,
    branch: Uuid,
    date: NaiveDate,
) -> Result<Option<ClosureRow>, sqlx::Error> {
    sqlx::query_as!(
        ClosureRow,
        r#"
        SELECT c.id, c.closed_at, c.closed_by, c.request_id, c.request_hash,
          c.report_snapshot AS "snapshot!: sqlx::types::Json<SalesClosing>",
          c.counts AS "counts!: sqlx::types::Json<ClosingCounts>",
          c.comparison AS "comparison!: sqlx::types::Json<Comparison>"
        FROM branch_day_closures c
        WHERE c.branch_id = $1 AND c.business_date = $2
    "#,
        branch,
        date
    )
    .fetch_optional(db)
    .await
}
pub async fn insert_closure(
    db: &mut PgConnection,
    input: &CloseDayInput,
    comparison: &Comparison,
    report: &SalesClosing,
    hash: &[u8],
    actor: &str,
) -> Result<(), sqlx::Error> {
    let counts = sqlx::types::Json(&input.counts);
    let comparison = sqlx::types::Json(comparison);
    let snapshot = sqlx::types::Json(report);
    sqlx::query!(r#"INSERT INTO branch_day_closures(branch_id,business_date,counts,comparison,report_snapshot,request_id,request_hash,closed_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"#, input.branch_id,input.date,counts as _,comparison as _,snapshot as _,input.request_id,hash,actor)
        .execute(db).await?;
    Ok(())
}
