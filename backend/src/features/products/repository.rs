use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{Product, ProductLocationStock, StockEntryInput};

async fn fetch_products(
    state: &AppState,
    product_id: Option<Uuid>,
) -> Result<Vec<Product>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            p.id,
            p.name,
            p.sku,
            p.unit_price::float8 AS "unit_price!",
            p.is_active,
            COALESCE(
                json_agg(
                    json_build_object(
                        'locationId', b.id,
                        'location', b.name,
                        'quantity', ps.quantity
                    )
                    ORDER BY b.name
                ) FILTER (WHERE ps.id IS NOT NULL),
                '[]'
            ) AS "locations!: Json<Vec<ProductLocationStock>>"
        FROM products p
        LEFT JOIN product_stock ps ON ps.product_id = p.id
        LEFT JOIN branch b ON b.id = ps.branch_id
        WHERE $1::uuid IS NULL OR p.id = $1
        GROUP BY p.id, p.name, p.sku, p.unit_price, p.is_active
        ORDER BY p.name
        "#,
        product_id,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| Product {
            id: row.id,
            name: row.name,
            sku: row.sku,
            unit_price: row.unit_price,
            is_active: row.is_active,
            locations: row.locations.0,
        })
        .collect())
}

// Returns inactive products too — the products page lists them behind a status
// filter, and the invoice form narrows to the active ones itself.
pub async fn list_products(state: &AppState) -> Result<Vec<Product>, sqlx::Error> {
    fetch_products(state, None).await
}

pub async fn get_product(
    state: &AppState,
    product_id: Uuid,
) -> Result<Option<Product>, sqlx::Error> {
    Ok(fetch_products(state, Some(product_id)).await?.pop())
}

async fn upsert_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    product_id: Uuid,
    entries: &[StockEntryInput],
) -> Result<(), sqlx::Error> {
    for entry in entries {
        sqlx::query!(
            r#"
            INSERT INTO product_stock (product_id, branch_id, quantity)
            VALUES ($1, $2, $3::float8)
            ON CONFLICT (product_id, branch_id)
            DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity
            "#,
            product_id,
            entry.location_id,
            entry.quantity,
        )
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub async fn create_product(
    state: &AppState,
    name: &str,
    sku: Option<&str>,
    unit_price: f64,
    entries: &[StockEntryInput],
) -> Result<Uuid, sqlx::Error> {
    let mut tx = state.db().begin().await?;

    let product_id = sqlx::query_scalar!(
        r#"
        INSERT INTO products (name, sku, unit_price)
        VALUES ($1, $2, $3::float8)
        RETURNING id
        "#,
        name,
        sku,
        unit_price,
    )
    .fetch_one(&mut *tx)
    .await?;

    upsert_stock(&mut tx, product_id, entries).await?;

    tx.commit().await?;

    Ok(product_id)
}

// COALESCE leaves any field the caller omitted untouched, so a partial update
// (e.g. just `is_active`) stays a single statement. `sku` needs the extra arm
// because it is the one nullable column: an omitted sku is `NULL` and must
// keep the stored value, while an explicit empty string means "clear it".
pub async fn update_product(
    state: &AppState,
    product_id: Uuid,
    name: Option<&str>,
    sku: Option<&str>,
    unit_price: Option<f64>,
    is_active: Option<bool>,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE products
        SET name = COALESCE($2, name),
            sku = CASE
                WHEN $3::text IS NULL THEN sku
                WHEN $3 = '' THEN NULL
                ELSE $3
            END,
            unit_price = COALESCE($4::float8, unit_price),
            is_active = COALESCE($5, is_active)
        WHERE id = $1
        RETURNING id
        "#,
        product_id,
        name,
        sku,
        unit_price,
        is_active,
    )
    .fetch_optional(state.db())
    .await
}

pub async fn add_stock(
    state: &AppState,
    product_id: Uuid,
    entries: &[StockEntryInput],
) -> Result<(), sqlx::Error> {
    let mut tx = state.db().begin().await?;

    upsert_stock(&mut tx, product_id, entries).await?;

    tx.commit().await?;

    Ok(())
}

// Tx-scoped so invoice creation can sell a product inside its own transaction,
// the way customers::repository's insert fns are shared with invoices.
//
// The guard is in the WHERE clause rather than a read-then-write, which makes
// the check and the decrement one atomic statement: concurrent sales of the
// last unit can't both succeed. `None` means the product has no stock row at
// that location, or not enough of it. The name comes back because the caller
// records it as the invoice line's description.
pub async fn decrement_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    product_id: Uuid,
    branch_id: Uuid,
    quantity: f64,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE product_stock ps
        SET quantity = ps.quantity - $3::float8
        FROM products p
        WHERE ps.product_id = $1
          AND ps.branch_id = $2
          AND ps.quantity >= $3::float8
          AND p.id = ps.product_id
        RETURNING p.name
        "#,
        product_id,
        branch_id,
        quantity,
    )
    .fetch_optional(&mut **tx)
    .await
}

// Only used to name a product in an out-of-stock message, so it runs on the
// failure path rather than being joined into the sale itself.
pub async fn product_name(
    tx: &mut sqlx::PgTransaction<'_>,
    product_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT name
        FROM products
        WHERE id = $1
        "#,
        product_id,
    )
    .fetch_optional(&mut **tx)
    .await
}
