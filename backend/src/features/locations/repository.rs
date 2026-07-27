use uuid::Uuid;

use crate::state::AppState;

use super::types::Location;

// Returns inactive locations too — the locations page lists them behind a
// status filter, and callers that need only usable ones filter by capability.
pub async fn list_locations(state: &AppState) -> Result<Vec<Location>, sqlx::Error> {
    sqlx::query_as!(
        Location,
        r#"
        SELECT id, name, receives_orders, holds_stock, is_active
        FROM branch
        ORDER BY name
        "#,
    )
    .fetch_all(state.db())
    .await
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
