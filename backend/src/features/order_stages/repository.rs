use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::OrderStage;

// `applies_to` and `status` exist only to be filtered on: the page offers them
// as multi-selects over what are really booleans, so the projection happens
// here rather than in the filter layer, mirroring `locations`'s `uses`/
// `status`. Their tokens are what the frontend's filter options carry as
// values.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            id,
            name,
            sort_order,
            requires_delivery,
            is_active,
            CASE WHEN requires_delivery THEN 'deliveriesOnly' ELSE 'everyOrder' END AS applies_to,
            CASE WHEN is_active THEN 'active' ELSE 'retired' END AS status
        FROM order_stages
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("name", ColumnDef::new("name", ColumnKind::Text)),
        (
            "sortOrder",
            ColumnDef::new("sort_order", ColumnKind::Number),
        ),
        (
            "requiresDelivery",
            ColumnDef::new("requires_delivery", ColumnKind::Bool),
        ),
        ("isActive", ColumnDef::new("is_active", ColumnKind::Bool)),
        ("appliesTo", ColumnDef::new("applies_to", ColumnKind::Text)),
        ("status", ColumnDef::new("status", ColumnKind::Text)),
    ],
    default_order: "sort_order ASC, name ASC",
};

// Returns retired stages too — the order stages page lists them behind a status
// filter, and the order checklist narrows to the active ones itself.
pub async fn list_stages(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<OrderStage>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn create_stage(
    state: &AppState,
    name: &str,
    sort_order: i32,
    requires_delivery: bool,
) -> Result<OrderStage, sqlx::Error> {
    sqlx::query_as!(
        OrderStage,
        r#"
        INSERT INTO order_stages (name, sort_order, requires_delivery)
        VALUES ($1, $2, $3)
        RETURNING id, name, sort_order, requires_delivery, is_active
        "#,
        name,
        sort_order,
        requires_delivery,
    )
    .fetch_one(state.db())
    .await
}

// COALESCE leaves any field the caller omitted untouched, so a partial update
// (e.g. just `is_active`) stays a single statement rather than a
// read-modify-write.
pub async fn update_stage(
    state: &AppState,
    stage_id: Uuid,
    name: Option<&str>,
    sort_order: Option<i32>,
    requires_delivery: Option<bool>,
    is_active: Option<bool>,
) -> Result<Option<OrderStage>, sqlx::Error> {
    sqlx::query_as!(
        OrderStage,
        r#"
        UPDATE order_stages
        SET name = COALESCE($2, name),
            sort_order = COALESCE($3, sort_order),
            requires_delivery = COALESCE($4, requires_delivery),
            is_active = COALESCE($5, is_active)
        WHERE id = $1
        RETURNING id, name, sort_order, requires_delivery, is_active
        "#,
        stage_id,
        name,
        sort_order,
        requires_delivery,
        is_active,
    )
    .fetch_optional(state.db())
    .await
}
