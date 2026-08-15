use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{Material, StockEntryInput};

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
        GROUP BY m.id, m.name, m.sku, m.unit
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("name", ColumnDef::new("name", ColumnKind::Text)),
        ("sku", ColumnDef::new("sku", ColumnKind::Text)),
        ("unit", ColumnDef::new("unit", ColumnKind::Text)),
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
