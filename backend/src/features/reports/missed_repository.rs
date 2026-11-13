use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::types::*;

pub struct MissedRow {
    pub id: Uuid,
    pub reason: String,
    pub resolved_at: DateTime<Utc>,
    pub resolved_by: String,
    pub request_id: Uuid,
    pub request_hash: Vec<u8>,
    pub snapshot: sqlx::types::Json<SalesClosing>,
}
impl MissedRow {
    pub fn into_report(self) -> SalesClosing {
        let mut report = self.snapshot.0;
        report.missed_closing = Some(MissedClosing {
            id: self.id,
            reason: self.reason,
            resolved_at: self.resolved_at,
            resolved_by: self.resolved_by,
        });
        report.read_only = true;
        report
    }
}
pub async fn missed(
    db: &mut PgConnection,
    branch: Uuid,
    date: NaiveDate,
) -> Result<Option<MissedRow>, sqlx::Error> {
    sqlx::query_as!(
        MissedRow,
        r#"SELECT id, reason, resolved_at, resolved_by, request_id, request_hash,
        report_snapshot AS "snapshot!: sqlx::types::Json<SalesClosing>"
        FROM branch_missed_closings WHERE branch_id=$1 AND business_date=$2"#,
        branch,
        date
    )
    .fetch_optional(db)
    .await
}
pub async fn insert_missed(
    db: &mut PgConnection,
    input: &ResolveMissedClosingInput,
    hash: &[u8],
    actor: &str,
    report: &SalesClosing,
) -> Result<(), sqlx::Error> {
    let snapshot = sqlx::types::Json(report);
    sqlx::query!("INSERT INTO branch_missed_closings(branch_id,business_date,reason,resolved_by,request_id,request_hash,report_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)", input.branch_id,input.date,input.reason,actor,input.request_id,hash,snapshot as _)
        .execute(db).await?;
    Ok(())
}
