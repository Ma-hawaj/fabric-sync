use uuid::Uuid;

use crate::state::AppState;

use super::types::OrderStage;

// Returns retired stages too — the order stages page lists them behind a status
// filter, and the order checklist narrows to the active ones itself.
pub async fn list_stages(state: &AppState) -> Result<Vec<OrderStage>, sqlx::Error> {
    sqlx::query_as!(
        OrderStage,
        r#"
        SELECT id, name, sort_order, requires_delivery, is_active
        FROM order_stages
        ORDER BY sort_order, name
        "#
    )
    .fetch_all(state.db())
    .await
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
