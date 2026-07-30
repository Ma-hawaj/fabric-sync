use serde::Serialize;
use sqlx::{postgres::PgRow, FromRow, PgPool, Postgres, Row};
use uuid::Uuid;

use crate::error::AppError;

use super::{
    columns::ListSpec,
    params::ListParams,
    sql::{self, BindValue},
};

/// The envelope every list endpoint returns. `total` is the number of rows
/// matching the filters, not the number returned, so the client can size its
/// pager without a second request.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub data: Vec<T>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
    pub page_count: i64,
}

type PgQuery<'q> = sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments>;

fn bind_all<'q>(mut query: PgQuery<'q>, binds: &'q [BindValue]) -> PgQuery<'q> {
    for bind in binds {
        query = match bind {
            BindValue::Text(value) => query.bind(value),
            BindValue::TextList(values) => query.bind(values),
            BindValue::Number(value) => query.bind(value),
            BindValue::Bool(value) => query.bind(value),
            BindValue::Date(value) => query.bind(value),
            BindValue::Uuid(value) => query.bind(value),
            BindValue::UuidList(values) => query.bind(values),
            BindValue::Int(value) => query.bind(value),
        };
    }

    query
}

/// Runs a feature's list query with the shared filtering, sorting and paging
/// applied. `T` is decoded straight off the row, so a feature contributes a
/// `ListSpec` and nothing else.
pub async fn fetch_page<T>(
    pool: &PgPool,
    spec: &ListSpec,
    params: &ListParams,
) -> Result<Page<T>, AppError>
where
    T: for<'r> FromRow<'r, PgRow> + Send + Unpin,
{
    let built = sql::build(spec, params)?;
    let rows = bind_all(sqlx::query(&built.sql), &built.binds)
        .fetch_all(pool)
        .await?;

    // Every row carries the same window count; with no rows there is nothing
    // matching, so the total is zero.
    let total = match rows.first() {
        Some(row) => row.try_get::<i64, _>("list_total")?,
        None => 0,
    };

    let data = rows
        .iter()
        .map(T::from_row)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Page {
        data,
        page: params.page,
        per_page: params.effective_per_page(total),
        total,
        page_count: params.page_count(total),
    })
}

/// Single-entity lookup over the same base query, so a feature's `SELECT` is
/// written once and serves both its list and its by-id reads.
pub async fn fetch_by_id<T>(pool: &PgPool, spec: &ListSpec, id: Uuid) -> Result<Option<T>, AppError>
where
    T: for<'r> FromRow<'r, PgRow> + Send + Unpin,
{
    let built = sql::build_by_id(spec, id)?;
    let row = bind_all(sqlx::query(&built.sql), &built.binds)
        .fetch_optional(pool)
        .await?;

    Ok(row.as_ref().map(T::from_row).transpose()?)
}
