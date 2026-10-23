use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{
    Material, MaterialPrices, StockEntryInput, TransferStockInput, UpdateMaterialInput,
};

// `total_quantity` and `location_names` mirror what the inventory table derives
// per row in the browser. They are computed by the same `GROUP BY` that builds
// the JSON, so filtering and sorting on them costs nothing extra.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            m.id,
            m.name,
            m.sku,
            m.unit,
            m.family,
            m.junior_price::float8 AS junior_price,
            m.normal_price::float8 AS normal_price,
            m.large_price::float8 AS large_price,
            COALESCE(sum(ms.quantity), 0)::float8 AS total_quantity,
            COALESCE(
                array_agg(b.name ORDER BY b.name) FILTER (WHERE ms.id IS NOT NULL),
                ARRAY[]::text[]
            ) AS location_names,
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
            ) AS locations
        FROM materials m
        LEFT JOIN material_stock ms ON ms.material_id = m.id
        LEFT JOIN branch b ON b.id = ms.branch_id
        GROUP BY m.id, m.name, m.sku, m.unit, m.family
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("name", ColumnDef::new("name", ColumnKind::Text)),
        ("sku", ColumnDef::new("sku", ColumnKind::Text)),
        ("unit", ColumnDef::new("unit", ColumnKind::Text)),
        ("family", ColumnDef::new("family", ColumnKind::Text)),
        (
            "totalQuantity",
            ColumnDef::new("total_quantity", ColumnKind::Number),
        ),
        (
            "locations",
            ColumnDef::new("location_names", ColumnKind::TextArray),
        ),
    ],
    default_order: "id ASC",
};

pub async fn list_materials(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Material>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn get_material(
    state: &AppState,
    material_id: Uuid,
) -> Result<Option<Material>, AppError> {
    list::fetch_by_id(state.db(), &SPEC, material_id).await
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
    family: Option<&str>,
    prices: &MaterialPrices,
    entries: &[StockEntryInput],
) -> Result<Uuid, sqlx::Error> {
    let mut tx = state.db().begin().await?;

    let material_id = sqlx::query_scalar!(
        r#"
        INSERT INTO materials (name, sku, unit, family, junior_price, normal_price, large_price)
        VALUES ($1, $2, $3, $4, $5::float8, $6::float8, $7::float8)
        RETURNING id
        "#,
        name,
        sku,
        unit,
        family,
        prices.junior_price,
        prices.normal_price,
        prices.large_price,
    )
    .fetch_one(&mut *tx)
    .await?;

    upsert_stock(&mut tx, material_id, entries).await?;

    tx.commit().await?;

    Ok(material_id)
}

pub async fn update_material(
    state: &AppState,
    id: Uuid,
    input: &UpdateMaterialInput,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query!(
        "UPDATE materials SET name = $2, sku = $3, unit = $4, family = $5, junior_price = $6::float8, normal_price = $7::float8, large_price = $8::float8 WHERE id = $1",
        id, input.name, input.sku, input.unit, input.family,
        input.prices.junior_price, input.prices.normal_price, input.prices.large_price
    ).execute(state.db()).await?.rows_affected() > 0)
}

#[derive(Debug, PartialEq, Eq)]
pub enum TransferResult {
    Transferred,
    MissingMaterial,
    InvalidDestination,
    InsufficientStock,
}

pub async fn transfer_stock(
    pool: &sqlx::PgPool,
    material_id: Uuid,
    input: &TransferStockInput,
) -> Result<TransferResult, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Serialize transfers of this material to avoid opposite-direction moves
    // locking stock rows in reverse order. NO KEY UPDATE allows invoice FK reads.
    let material = sqlx::query_scalar!(
        "SELECT id FROM materials WHERE id = $1 FOR NO KEY UPDATE",
        material_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if material.is_none() {
        return Ok(TransferResult::MissingMaterial);
    }
    let destination = sqlx::query_scalar!(
        "SELECT id FROM branch WHERE id = $1 AND is_active AND holds_stock FOR SHARE",
        input.to_location_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if destination.is_none() {
        return Ok(TransferResult::InvalidDestination);
    }
    if !decrement_stock(&mut tx, material_id, input.from_location_id, input.quantity).await? {
        return Ok(TransferResult::InsufficientStock);
    }
    upsert_stock(
        &mut tx,
        material_id,
        &[StockEntryInput {
            location_id: input.to_location_id,
            quantity: input.quantity,
        }],
    )
    .await?;
    tx.commit().await?;
    Ok(TransferResult::Transferred)
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

// Takes stock off, one guarded statement per location — the same atomic
// check-and-decrement shape as `decrement_stock`, but as a standalone call
// rather than inside an invoice's transaction. Returns the branch ids the
// guard refused (no row there, or not enough of it); the caller reports them
// and the transaction is dropped uncommitted, so a removal is all-or-nothing.
pub async fn remove_stock(
    state: &AppState,
    material_id: Uuid,
    entries: &[StockEntryInput],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let mut tx = state.db().begin().await?;

    let mut refused = Vec::new();
    for entry in entries {
        let result = sqlx::query!(
            r#"
            UPDATE material_stock
            SET quantity = quantity - $3::float8
            WHERE material_id = $1
              AND branch_id = $2
              AND quantity >= $3::float8
            "#,
            material_id,
            entry.location_id,
            entry.quantity,
        )
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            refused.push(entry.location_id);
        }
    }

    if refused.is_empty() {
        tx.commit().await?;
    }

    Ok(refused)
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn fixture(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
        let material =
            sqlx::query_scalar("INSERT INTO materials(name) VALUES('Cotton') RETURNING id")
                .fetch_one(pool)
                .await
                .unwrap();
        let from = sqlx::query_scalar("INSERT INTO branch(name) VALUES('Source') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();
        let to = sqlx::query_scalar("INSERT INTO branch(name) VALUES('Destination') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,10)")
            .bind(material)
            .bind(from)
            .execute(pool)
            .await
            .unwrap();
        (material, from, to)
    }
    async fn quantity(pool: &PgPool, material: Uuid, location: Uuid) -> f64 {
        sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0)::float8 FROM material_stock WHERE material_id=$1 AND branch_id=$2").bind(material).bind(location).fetch_one(pool).await.unwrap()
    }
    fn movement(from: Uuid, to: Uuid, quantity: f64) -> TransferStockInput {
        TransferStockInput {
            from_location_id: from,
            to_location_id: to,
            quantity,
        }
    }
    #[sqlx::test]
    async fn move_creates_and_then_updates_destination_without_changing_total(pool: PgPool) {
        let (material, from, to) = fixture(&pool).await;
        for amount in [3.25, 6.75] {
            assert_eq!(
                transfer_stock(&pool, material, &movement(from, to, amount))
                    .await
                    .unwrap(),
                TransferResult::Transferred
            );
        }
        assert_eq!(quantity(&pool, material, from).await, 0.0);
        assert_eq!(quantity(&pool, material, to).await, 10.0);
    }
    #[sqlx::test]
    async fn refused_moves_never_debit_source(pool: PgPool) {
        let (material, from, to) = fixture(&pool).await;
        assert_eq!(
            transfer_stock(&pool, material, &movement(from, to, 11.0))
                .await
                .unwrap(),
            TransferResult::InsufficientStock
        );
        for (active, holds) in [(false, true), (true, false)] {
            sqlx::query("UPDATE branch SET is_active=$2, holds_stock=$3 WHERE id=$1")
                .bind(to)
                .bind(active)
                .bind(holds)
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                transfer_stock(&pool, material, &movement(from, to, 1.0))
                    .await
                    .unwrap(),
                TransferResult::InvalidDestination
            );
        }
        assert_eq!(
            transfer_stock(&pool, Uuid::new_v4(), &movement(from, to, 1.0))
                .await
                .unwrap(),
            TransferResult::MissingMaterial
        );
        assert_eq!(quantity(&pool, material, from).await, 10.0);
        assert_eq!(quantity(&pool, material, to).await, 0.0);
    }
    #[sqlx::test]
    async fn destination_write_failure_rolls_back_source_debit(pool: PgPool) {
        let (material, from, to) = fixture(&pool).await;
        sqlx::query(
            "INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,99999999.99)",
        )
        .bind(material)
        .bind(to)
        .execute(&pool)
        .await
        .unwrap();
        assert!(transfer_stock(&pool, material, &movement(from, to, 1.0))
            .await
            .is_err());
        assert_eq!(quantity(&pool, material, from).await, 10.0);
        assert_eq!(quantity(&pool, material, to).await, 99_999_999.99);
    }
    #[sqlx::test]
    async fn concurrent_moves_cannot_overdraw_the_source(pool: PgPool) {
        let (material, from, to) = fixture(&pool).await;
        let a = movement(from, to, 8.0);
        let b = a.clone();
        let (a, b) = tokio::join!(
            transfer_stock(&pool, material, &a),
            transfer_stock(&pool, material, &b)
        );
        let results = [a.unwrap(), b.unwrap()];
        assert_eq!(
            results
                .iter()
                .filter(|r| **r == TransferResult::Transferred)
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|r| **r == TransferResult::InsufficientStock)
                .count(),
            1
        );
        assert_eq!(quantity(&pool, material, from).await, 2.0);
        assert_eq!(quantity(&pool, material, to).await, 8.0);
    }
    #[sqlx::test]
    async fn opposite_moves_serialize_without_deadlock(pool: PgPool) {
        let (material, from, to) = fixture(&pool).await;
        transfer_stock(&pool, material, &movement(from, to, 5.0))
            .await
            .unwrap();
        let a = movement(from, to, 1.0);
        let b = movement(to, from, 1.0);
        let (a, b) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            tokio::join!(
                transfer_stock(&pool, material, &a),
                transfer_stock(&pool, material, &b)
            )
        })
        .await
        .unwrap();
        assert_eq!(a.unwrap(), TransferResult::Transferred);
        assert_eq!(b.unwrap(), TransferResult::Transferred);
        assert_eq!(quantity(&pool, material, from).await, 5.0);
        assert_eq!(quantity(&pool, material, to).await, 5.0);
    }
    #[sqlx::test]
    async fn edit_saves_metadata_and_prices_together_without_affecting_stock(pool: PgPool) {
        let (material, from, _) = fixture(&pool).await;
        let state = crate::test_support::state(pool.clone(), None, None).await;
        let input = UpdateMaterialInput {
            name: "Linen".into(),
            sku: Some("LN".into()),
            unit: "yards".into(),
            family: None,
            prices: MaterialPrices {
                junior_price: 10.0,
                normal_price: 20.0,
                large_price: 30.0,
            },
        };
        assert!(update_material(&state, material, &input).await.unwrap());
        let saved = get_material(&state, material).await.unwrap().unwrap();
        assert_eq!(saved.name, "Linen");
        assert_eq!(saved.sku.as_deref(), Some("LN"));
        assert_eq!(saved.family, None);
        assert_eq!(saved.unit, "yards");
        assert_eq!(saved.normal_price, Some(20.0));
        assert_eq!(quantity(&pool, material, from).await, 10.0);
    }
}
