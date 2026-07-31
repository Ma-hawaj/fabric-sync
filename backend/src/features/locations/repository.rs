use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::Location;

// `uses` and `status` exist only to be filtered on: the list page offers them as
// multi-selects over what are really booleans, so the projection happens here
// rather than in the filter layer. Their tokens are what the frontend's filter
// options carry as values.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            id,
            name,
            receives_orders,
            holds_stock,
            is_active,
            array_remove(
                ARRAY[
                    CASE WHEN receives_orders THEN 'receivesOrders' END,
                    CASE WHEN holds_stock THEN 'holdsStock' END
                ],
                NULL
            ) AS uses,
            CASE WHEN is_active THEN 'active' ELSE 'inactive' END AS status
        FROM branch
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("name", ColumnDef::new("name", ColumnKind::Text)),
        ("uses", ColumnDef::new("uses", ColumnKind::TextArray)),
        ("status", ColumnDef::new("status", ColumnKind::Text)),
        (
            "receivesOrders",
            ColumnDef::new("receives_orders", ColumnKind::Bool),
        ),
        (
            "holdsStock",
            ColumnDef::new("holds_stock", ColumnKind::Bool),
        ),
        ("isActive", ColumnDef::new("is_active", ColumnKind::Bool)),
    ],
    default_order: "name ASC",
};

// Returns inactive locations too — the locations page lists them behind a
// status filter, and callers that need only usable ones filter by capability.
pub async fn list_locations(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Location>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn create_location(
    state: &AppState,
    name: &str,
    receives_orders: bool,
    holds_stock: bool,
) -> Result<Location, sqlx::Error> {
    sqlx::query_as!(
        Location,
        r#"
        INSERT INTO branch (name, receives_orders, holds_stock)
        VALUES ($1, $2, $3)
        RETURNING id, name, receives_orders, holds_stock, is_active
        "#,
        name,
        receives_orders,
        holds_stock,
    )
    .fetch_one(state.db())
    .await
}

// COALESCE leaves any field the caller omitted untouched, so a partial update
// (e.g. just `is_active`) stays a single statement rather than a read-modify-write.
pub async fn update_location(
    state: &AppState,
    location_id: Uuid,
    name: Option<&str>,
    receives_orders: Option<bool>,
    holds_stock: Option<bool>,
    is_active: Option<bool>,
) -> Result<Option<Location>, sqlx::Error> {
    sqlx::query_as!(
        Location,
        r#"
        UPDATE branch
        SET name = COALESCE($2, name),
            receives_orders = COALESCE($3, receives_orders),
            holds_stock = COALESCE($4, holds_stock),
            is_active = COALESCE($5, is_active)
        WHERE id = $1
        RETURNING id, name, receives_orders, holds_stock, is_active
        "#,
        location_id,
        name,
        receives_orders,
        holds_stock,
        is_active,
    )
    .fetch_optional(state.db())
    .await
}
