use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use super::types::*;

pub struct OpeningRow {
    pub id: Uuid,
    pub amount: f64,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub notes: String,
    pub supersedes_id: Option<Uuid>,
    pub request_hash: Vec<u8>,
}

impl OpeningRow {
    pub fn into_opening(self) -> CashOpening {
        CashOpening {
            id: self.id,
            amount: self.amount,
            recorded_at: self.recorded_at,
            recorded_by: self.recorded_by,
            notes: self.notes,
            supersedes_id: self.supersedes_id,
        }
    }
}

pub async fn opening(
    db: &mut PgConnection,
    branch: Uuid,
    date: NaiveDate,
    request: Option<Uuid>,
) -> Result<Option<OpeningRow>, sqlx::Error> {
    sqlx::query_as!(
        OpeningRow,
        r#"
        SELECT o.id, o.amount::float8 AS "amount!", o.recorded_at, o.recorded_by,
               o.notes, o.supersedes_id, o.request_hash
        FROM branch_cash_openings o
        WHERE ($3::uuid IS NOT NULL AND o.request_id = $3)
           OR ($3 IS NULL AND o.branch_id = $1 AND o.business_date = $2
               AND NOT EXISTS(SELECT 1 FROM branch_cash_openings n WHERE n.supersedes_id = o.id))
    "#,
        branch,
        date,
        request
    )
    .fetch_optional(db)
    .await
}

pub async fn insert_opening(
    db: &mut PgConnection,
    input: &SaveOpeningInput,
    hash: &[u8],
    actor: &str,
    previous: Option<Uuid>,
) -> Result<CashOpening, sqlx::Error> {
    let row = sqlx::query_as!(OpeningRow, r#"
        INSERT INTO branch_cash_openings(branch_id,business_date,amount,notes,supersedes_id,request_id,request_hash,recorded_by)
        VALUES($1,$2,$3::float8,$4,$5,$6,$7,$8)
        RETURNING id, amount::float8 AS "amount!", recorded_at, recorded_by, notes, supersedes_id, request_hash
    "#, input.branch_id, input.date, input.amount, input.notes, previous, input.request_id, hash, actor).fetch_one(db).await?;
    Ok(row.into_opening())
}

pub struct ExpenseRow {
    pub id: Uuid,
    pub branch_id: Uuid,
    pub business_date: NaiveDate,
    pub amount: f64,
    pub payment_type: String,
    pub reason: String,
    pub paid_to: String,
    pub reference: String,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub request_hash: Vec<u8>,
    pub voided_at: Option<DateTime<Utc>>,
    pub void_reason: Option<String>,
    pub voided_by: Option<String>,
    pub void_request_id: Option<Uuid>,
    pub void_request_hash: Option<Vec<u8>>,
}

impl ExpenseRow {
    pub fn into_expense(self) -> BranchExpense {
        BranchExpense {
            id: self.id,
            amount: self.amount,
            payment_type: self.payment_type,
            reason: self.reason,
            paid_to: self.paid_to,
            reference: self.reference,
            recorded_at: self.recorded_at,
            recorded_by: self.recorded_by,
            voided_at: self.voided_at,
            void_reason: self.void_reason,
            voided_by: self.voided_by,
        }
    }
}

pub async fn expenses(
    db: &mut PgConnection,
    branch: Option<Uuid>,
    date: Option<NaiveDate>,
    request: Option<Uuid>,
    id: Option<Uuid>,
) -> Result<Vec<ExpenseRow>, sqlx::Error> {
    sqlx::query_file_as!(
        ExpenseRow,
        "src/features/reports/sql/expenses.sql",
        branch,
        date,
        request,
        id
    )
    .fetch_all(db)
    .await
}

pub async fn insert_expense(
    db: &mut PgConnection,
    input: &RecordExpenseInput,
    hash: &[u8],
    actor: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(r#"
        INSERT INTO branch_expenses(branch_id,business_date,amount,payment_type,reason,paid_to,reference,request_id,request_hash,recorded_by)
        VALUES($1,$2,$3::float8,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    "#, input.branch_id, input.date, input.amount, input.payment_type.as_str(), input.reason, input.paid_to, input.reference, input.request_id, hash, actor).fetch_one(db).await
}

pub async fn insert_void(
    db: &mut PgConnection,
    expense: Uuid,
    input: &VoidExpenseInput,
    hash: &[u8],
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO branch_expense_voids(expense_id,reason,request_id,request_hash,recorded_by)
        VALUES($1,$2,$3,$4,$5)
    "#,
        expense,
        input.reason,
        input.request_id,
        hash,
        actor
    )
    .execute(db)
    .await?;
    Ok(())
}
