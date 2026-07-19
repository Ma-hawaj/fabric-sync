use crate::state::AppState;

use super::types::Location;

pub async fn list_locations(state: &AppState) -> Result<Vec<Location>, sqlx::Error> {
    sqlx::query_as!(
        Location,
        r#"
        SELECT id, name
        FROM branch
        ORDER BY name
        "#,
    )
    .fetch_all(state.db())
    .await
}
