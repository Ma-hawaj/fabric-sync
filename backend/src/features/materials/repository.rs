use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{Material, MaterialLocationStock, StockEntryInput};

async fn fetch_materials(
    state: &AppState,
    material_id: Option<Uuid>,
) -> Result<Vec<Material>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            m.id,
            m.name,
            m.sku,
            m.unit,
            COALESCE(
                json_agg(
                    json_build_object(
                        'locationId', b.id,
                        'location', b.name,
                        'quantity', ms.quantity
                    )
                    ORDER BY b.name
                ) FILTER (WHERE ms.id IS NOT NULL),
                '[]'
            ) AS "locations!: Json<Vec<MaterialLocationStock>>"
        FROM materials m
        LEFT JOIN material_stock ms ON ms.material_id = m.id
        LEFT JOIN branch b ON b.id = ms.branch_id
        WHERE $1::uuid IS NULL OR m.id = $1
        GROUP BY m.id, m.name, m.sku, m.unit
        ORDER BY m.id
        "#,
        material_id,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| Material {
            id: row.id,
            name: row.name,
            sku: row.sku,
            unit: row.unit,
            locations: row.locations.0,
        })
        .collect())
}

pub async fn list_materials(state: &AppState) -> Result<Vec<Material>, sqlx::Error> {
    fetch_materials(state, None).await
}

pub async fn get_material(
    state: &AppState,
    material_id: Uuid,
) -> Result<Option<Material>, sqlx::Error> {
    Ok(fetch_materials(state, Some(material_id)).await?.pop())
}

async fn upsert_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    material_id: Uuid,
    entries: &[StockEntryInput],
) -> Result<(), sqlx::Error> {
    for entry in entries {
        sqlx::query!(
            r#"
            INSERT INTO material_stock (material_id, branch_id, quantity)
            VALUES ($1, $2, $3::float8)
            ON CONFLICT (material_id, branch_id)
            DO UPDATE SET quantity = material_stock.quantity + EXCLUDED.quantity
            "#,
            material_id,
            entry.location_id,
            entry.quantity,
        )
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub async fn create_material(
    state: &AppState,
    name: &str,
    sku: Option<&str>,
    unit: &str,
    entries: &[StockEntryInput],
) -> Result<Uuid, sqlx::Error> {
    let mut tx = state.db().begin().await?;

    let material_id = sqlx::query_scalar!(
        r#"
        INSERT INTO materials (name, sku, unit)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        name,
        sku,
        unit,
    )
    .fetch_one(&mut *tx)
    .await?;

    upsert_stock(&mut tx, material_id, entries).await?;

    tx.commit().await?;

    Ok(material_id)
}

pub async fn add_stock(
    state: &AppState,
    material_id: Uuid,
    entries: &[StockEntryInput],
) -> Result<(), sqlx::Error> {
    let mut tx = state.db().begin().await?;

    upsert_stock(&mut tx, material_id, entries).await?;

    tx.commit().await?;

    Ok(())
}

// Tx-scoped so invoice creation can consume material inside its own
// transaction, the way products_repository::decrement_stock is shared with
// invoices.
//
// The guard is in the WHERE clause rather than a read-then-write, which makes
// the check and the decrement one atomic, row-locked statement: concurrent
// orders against the last few units of a material can't both succeed.
// `false` means the material has no stock row at that location, or not
// enough of it.
pub async fn decrement_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    material_id: Uuid,
    branch_id: Uuid,
    amount: f64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE material_stock
        SET quantity = quantity - $3::float8
        WHERE material_id = $1
          AND branch_id = $2
          AND quantity >= $3::float8
        "#,
        material_id,
        branch_id,
        amount,
    )
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected() > 0)
}

// Only used to name a material in an out-of-stock message, so it runs on the
// failure path rather than being joined into the consumption itself.
pub async fn material_name(
    tx: &mut sqlx::PgTransaction<'_>,
    material_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT name
        FROM materials
        WHERE id = $1
        "#,
        material_id,
    )
    .fetch_optional(&mut **tx)
    .await
}
