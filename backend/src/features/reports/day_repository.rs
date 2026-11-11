use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::types::*;

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

pub async fn previous_unclosed(
    db: &mut PgConnection,
    branch: Uuid,
    zone: &str,
    before: NaiveDate,
) -> Result<Option<NaiveDate>, sqlx::Error> {
    sqlx::query_file_scalar!(
        "src/features/reports/sql/active_days.sql",
        branch,
        zone,
        before
    )
    .fetch_one(db)
    .await
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
