use sqlx::types::Json;

use crate::state::AppState;

use super::types::{Customer, Measurement};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            c.id,
            c.name,
            c.mobile_no,
            COALESCE(
                json_agg(to_jsonb(m) ORDER BY m.measurement_date DESC, m.id DESC)
                    FILTER (WHERE m.id IS NOT NULL),
                '[]'
            ) AS "measurements!: Json<Vec<Measurement>>"
        FROM customers c
        LEFT JOIN measurements m ON m.customer_id = c.id
        GROUP BY c.id, c.name, c.mobile_no
        ORDER BY c.id
        "#,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| Customer {
            id: row.id,
            name: row.name,
            mobile_no: row.mobile_no,
            measurements: row.measurements.0,
        })
        .collect())
}
