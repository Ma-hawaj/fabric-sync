use super::types::AttentionRow;
use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec, Page},
};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

// Requests define outstanding work. Closing a preview leaves its business
// request pending, while untracked business records never become reminders.
const SPEC: ListSpec = ListSpec {
    base_sql: include_str!("attention.sql"),
    columns: &[
        ("reference", ColumnDef::new("reference", ColumnKind::Text)),
        (
            "invoiceNumber",
            ColumnDef::new("invoice_number", ColumnKind::Number),
        ),
        (
            "customerName",
            ColumnDef::new("customer_name", ColumnKind::Text),
        ),
        (
            "customerMobile",
            ColumnDef::new("customer_mobile", ColumnKind::Text),
        ),
        (
            "branchName",
            ColumnDef::new("branch_name", ColumnKind::Text),
        ),
        ("kind", ColumnDef::new("kind", ColumnKind::Text)),
        ("status", ColumnDef::new("status", ColumnKind::Text)),
        (
            "needsAttention",
            ColumnDef::new("needs_attention", ColumnKind::Bool),
        ),
        (
            "waitingSince",
            ColumnDef::new("waiting_since", ColumnKind::Date),
        ),
    ],
    default_order: "waiting_since ASC, entity_id ASC, kind ASC",
};

pub async fn list(db: &PgPool, params: &ListParams) -> Result<Page<AttentionRow>, AppError> {
    list::fetch_page(db, &SPEC, params).await
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttentionSummary {
    pub total: i64,
    pub not_sent: i64,
    pub failed: i64,
    pub uncertain: i64,
    pub delayed: i64,
}

pub async fn summary(db: &PgPool) -> Result<AttentionSummary, AppError> {
    let query = format!(
        "SELECT count(*) AS total, \
         count(*) FILTER (WHERE status = 'not_sent') AS not_sent, \
         count(*) FILTER (WHERE status = 'failed') AS failed, \
         count(*) FILTER (WHERE status = 'uncertain') AS uncertain, \
         count(*) FILTER (WHERE status = 'delayed') AS delayed \
         FROM ({}) AS attention WHERE needs_attention",
        SPEC.base_sql
    );
    Ok(sqlx::query_as(&query).fetch_one(db).await?)
}
