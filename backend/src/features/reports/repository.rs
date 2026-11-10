use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::types::*;

// One statement gives every ledger the same PostgreSQL snapshot. Never join
// payment/return rows to one another: that would multiply their amounts.
// Money stays integer cents until the response boundary.
pub async fn activity(
    db: &mut PgConnection,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    branch_id: Uuid,
) -> Result<Vec<ActivityRow>, sqlx::Error> {
    sqlx::query_as!(
        ActivityRow,
        r#"
        SELECT COALESCE(i.issuing_branch_id, i.branch_id) AS "branch_id?", e.id AS "id!", e.invoice_id AS "invoice_id!",
               i.invoice_number AS "invoice_number!", e.occurred_at AS "occurred_at!",
               e.kind AS "kind!", e.method AS "method?",
               (e.amount * 100)::bigint AS "amount_cents!",
               (e.taxable * 100)::bigint AS "taxable_cents!",
               (e.vat * 100)::bigint AS "vat_cents!",
               (e.gift_sales * 100)::bigint AS "gift_sales_cents!"
        FROM (
            SELECT i.id, i.id AS invoice_id, i.invoice_date AS occurred_at,
                   'sale'::text AS kind, NULL::text AS method, i.total_price AS amount,
                   i.taxable_amount AS taxable, i.vat_amount AS vat,
                   COALESCE((SELECT SUM(line_total) FROM invoice_items
                             WHERE invoice_id = i.id AND kind = 'gift_card'), 0) AS gift_sales
            FROM invoices i
            UNION ALL
            SELECT id, invoice_id, paid_at, 'payment', payment_type, amount, 0, 0, 0
            FROM invoice_payments
            UNION ALL
            SELECT id, invoice_id, created_at, 'credit', NULL, amount, 0, 0, 0
            FROM invoice_returns
            UNION ALL
            SELECT id, invoice_id, created_at, 'refund', payment_type, amount, 0, 0, 0
            FROM invoice_refunds
            UNION ALL
            SELECT id, invoice_id, redeemed_at, 'gift_card_redemption', 'gift_card', amount, 0, 0, 0
            FROM gift_card_redemptions
            UNION ALL
            SELECT r.id, o.invoice_id, r.received_at, 'repair_payment',
                   r.received_payment_type, r.received_amount, 0, 0, 0
            FROM order_repairs r JOIN orders o ON o.id = r.order_id
            WHERE r.received_amount > 0 AND r.received_at IS NOT NULL
        ) e
        JOIN invoices i ON i.id = e.invoice_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2
          AND (COALESCE(i.issuing_branch_id, i.branch_id) = $3 OR COALESCE(i.issuing_branch_id, i.branch_id) IS NULL)
        ORDER BY e.occurred_at, e.kind, e.id
        "#,
        start,
        end,
        branch_id,
    )
    .fetch_all(db)
    .await
}

pub async fn branch_name(
    db: &mut PgConnection,
    branch_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!("SELECT name FROM branch WHERE id = $1", branch_id)
        .fetch_optional(db)
        .await
}

pub struct CheckRow {
    pub id: Uuid,
    pub checked_at: DateTime<Utc>,
    pub report_fingerprint: String,
    pub request_hash: Vec<u8>,
    pub counts: sqlx::types::Json<ClosingCounts>,
    pub comparison: sqlx::types::Json<Comparison>,
}

impl CheckRow {
    pub fn into_check(self) -> ClosingCheck {
        ClosingCheck {
            id: self.id,
            checked_at: self.checked_at,
            fingerprint: self.report_fingerprint,
            counts: self.counts.0,
            comparison: self.comparison.0,
        }
    }
}

pub async fn latest_check(
    db: &mut PgConnection,
    branch_id: Uuid,
    date: chrono::NaiveDate,
) -> Result<Option<ClosingCheck>, sqlx::Error> {
    Ok(sqlx::query_as!(
        CheckRow,
        r#"
        SELECT id, checked_at, report_fingerprint, request_hash,
               counts AS "counts!: sqlx::types::Json<ClosingCounts>",
               comparison AS "comparison!: sqlx::types::Json<Comparison>"
        FROM branch_closing_checks WHERE branch_id = $1 AND report_date = $2
        ORDER BY checked_at DESC, id DESC LIMIT 1
    "#,
        branch_id,
        date
    )
    .fetch_optional(db)
    .await?
    .map(CheckRow::into_check))
}

pub async fn replay(db: &mut PgConnection, request: Uuid) -> Result<Option<CheckRow>, sqlx::Error> {
    sqlx::query_as!(
        CheckRow,
        r#"
        SELECT id, checked_at, report_fingerprint, request_hash,
               counts AS "counts!: sqlx::types::Json<ClosingCounts>",
               comparison AS "comparison!: sqlx::types::Json<Comparison>"
        FROM branch_closing_checks WHERE request_id = $1
    "#,
        request
    )
    .fetch_optional(db)
    .await
}

pub async fn save_check(
    db: &mut PgConnection,
    input: &SaveClosingInput,
    hash: &[u8],
    comparison: &Comparison,
    report: &SalesClosing,
    actor: &str,
) -> Result<ClosingCheck, sqlx::Error> {
    let counts = sqlx::types::Json(&input.counts);
    let compared = sqlx::types::Json(comparison);
    let snapshot = sqlx::types::Json(report);
    let row = sqlx::query_as!(CheckRow, r#"
        INSERT INTO branch_closing_checks(branch_id, report_date, request_id, request_hash, report_fingerprint, counts, comparison, report_snapshot, checked_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id, checked_at, report_fingerprint, request_hash,
                  counts AS "counts!: sqlx::types::Json<ClosingCounts>",
                  comparison AS "comparison!: sqlx::types::Json<Comparison>"
    "#, input.branch_id, input.date, input.request_id, hash, input.fingerprint, counts as _, compared as _, snapshot as _, actor)
        .fetch_one(db).await?;
    Ok(row.into_check())
}
