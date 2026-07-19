use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{Customer, Measurement};

async fn fetch_customers(
    state: &AppState,
    customer_id: Option<Uuid>,
) -> Result<Vec<Customer>, sqlx::Error> {
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
        WHERE $1::uuid IS NULL OR c.id = $1
        GROUP BY c.id, c.name, c.mobile_no
        ORDER BY c.id
        "#,
        customer_id,
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

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, sqlx::Error> {
    fetch_customers(state, None).await
}

pub async fn get_customer(
    state: &AppState,
    customer_id: Uuid,
) -> Result<Option<Customer>, sqlx::Error> {
    Ok(fetch_customers(state, Some(customer_id)).await?.pop())
}

pub async fn create_customer(
    state: &AppState,
    name: &str,
    mobile_no: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO customers (name, mobile_no)
        VALUES ($1, $2)
        RETURNING id
        "#,
        name,
        mobile_no,
    )
    .fetch_one(state.db())
    .await
}
