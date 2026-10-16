use sqlx::types::Json;
use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{CreateMeasurementInput, Customer, Measurement};

// The `GROUP BY` is on the customer's primary key, so the wrapper's `LIMIT`
// counts customers rather than measurement rows. `last_measured_on` is exposed
// so the list can be sorted by recency without unpacking the JSON. `invoices`
// rides along as a correlated aggregate — tailoring invoices through the
// customer's orders plus retail sales billed to them directly — so one read
// carries the sheet's whole invoice history with no second request filtered
// by phone number. Money state reuses the ledger derivation from the invoices
// feature (paid sum, status, balance floored at zero).
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            c.id,
            c.name,
            c.mobile_no,
            max(m.measurement_date) AS last_measured_on,
            count(m.id) AS measurement_count,
            COALESCE(
                json_agg(to_jsonb(m) ORDER BY m.measurement_date DESC, m.id DESC)
                    FILTER (WHERE m.id IS NOT NULL),
                '[]'
            ) AS measurements,
            COALESCE(
                (
                    SELECT json_agg(inv ORDER BY inv."invoiceDate" DESC, inv."invoiceNumber" DESC)
                    FROM (
                        SELECT
                            i.id AS "id",
                            i.invoice_number AS "invoiceNumber",
                            i.invoice_date AS "invoiceDate",
                            i.target_date AS "targetDate",
                            i.total_price::float8 AS "totalPrice",
                            pay.status AS "paymentStatus",
                            GREATEST(i.total_price - i.gift_card_redeemed - pay.paid, 0)::float8 AS "balanceDue"
                        FROM invoices i
                        LEFT JOIN LATERAL (
                            SELECT
                                COALESCE(SUM(amount), 0)::float8 AS paid,
                                CASE
                                    WHEN GREATEST(
                                        i.total_price - i.gift_card_redeemed - COALESCE(SUM(amount), 0),
                                        0
                                    ) = 0 THEN 'paid'
                                    WHEN COALESCE(SUM(amount), 0) = 0 THEN 'unpaid'
                                    ELSE 'partial'
                                END AS status
                            FROM invoice_payments
                            WHERE invoice_id = i.id
                        ) pay ON true
                        WHERE i.customer_id = c.id
                           OR EXISTS (
                               SELECT 1
                               FROM orders o
                               JOIN measurements om ON om.id = o.measurement_id
                               WHERE o.invoice_id = i.id
                                 AND om.customer_id = c.id
                           )
                    ) inv
                ),
                '[]'
            ) AS invoices
        FROM customers c
        LEFT JOIN measurements m ON m.customer_id = c.id
        GROUP BY c.id, c.name, c.mobile_no
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("name", ColumnDef::new("name", ColumnKind::Text)),
        ("mobileNo", ColumnDef::new("mobile_no", ColumnKind::Text)),
        (
            "lastMeasuredOn",
            ColumnDef::new("last_measured_on", ColumnKind::Date),
        ),
        (
            "measurementCount",
            ColumnDef::new("measurement_count", ColumnKind::Number),
        ),
    ],
    default_order: "id ASC",
};

pub async fn list_customers(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Customer>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn get_customer(
    state: &AppState,
    customer_id: Uuid,
) -> Result<Option<Customer>, AppError> {
    list::fetch_by_id(state.db(), &SPEC, customer_id).await
}

/// The measurement record that backs an order — the snapshot captured when its
/// invoice was created. The orders feature reads it to show the exact
/// measurements a garment was cut to.
pub async fn get_measurement(
    state: &AppState,
    measurement_id: Uuid,
) -> Result<Option<Measurement>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            to_jsonb(m) AS "measurement!: Json<Measurement>"
        FROM measurements m
        WHERE m.id = $1
        "#,
        measurement_id,
    )
    .fetch_optional(state.db())
    .await?;

    Ok(row.map(|row| row.measurement.0))
}

// Also used by the invoices feature, which records a measurement snapshot per
// customer inside its own transaction and needs the new row's id for orders.
pub async fn insert_measurement(
    tx: &mut sqlx::PgTransaction<'_>,
    customer_id: Uuid,
    measurement: &CreateMeasurementInput,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO measurements (
            customer_id, measurement_date, type, fit,
            front_height, back_height, chest, waist, hip, shoulder, shoulder_down,
            sleeve_length, neck_size, open_hand, open_hand_folding, chest_up,
            cuff_width, cuff_size, neck_width, armhole, fo_width, fo, bottom, bottom_fold,
            full_body, sleeve_half, open_fold, front_pocket_length,
            front_pocket_length_by_width,
            side_pocket, side_pocket_length_by_width,
            mobile_pocket_length_by_width
        )
        VALUES (
            $1, $2, $3, $4,
            $5::float8, $6::float8, $7::float8, $8::float8, $9::float8, $10::float8, $11::float8,
            $12::float8, $13::float8, $14::float8, $15::float8, $16::float8,
            $17::float8, $18::float8, $19::float8, $20::float8, $21::float8, $22::float8,
            $23::float8, $24::float8, $25::float8, $26::float8, $27::float8, $28::float8,
            $29, $30::float8, $31,
            $32
        )
        RETURNING id
        "#,
        customer_id,
        measurement.date,
        measurement.r#type,
        measurement.fit,
        measurement.front_height,
        measurement.back_height,
        measurement.chest,
        measurement.waist,
        measurement.hip,
        measurement.shoulder,
        measurement.shoulder_down,
        measurement.sleeve_length,
        measurement.neck_size,
        measurement.open_hand,
        measurement.open_hand_folding,
        measurement.chest_up,
        measurement.cuff_width,
        measurement.cuff_size,
        measurement.neck_width,
        measurement.armhole,
        measurement.fo_width,
        measurement.fo,
        measurement.bottom,
        measurement.bottom_fold,
        measurement.full_body,
        measurement.sleeve_half,
        measurement.open_fold,
        measurement.front_pocket_length,
        measurement.front_pocket_length_by_width,
        measurement.side_pocket,
        measurement.side_pocket_length_by_width,
        measurement.mobile_pocket_length_by_width,
    )
    .fetch_one(&mut **tx)
    .await
}

// Tx-scoped so the invoices feature can check it against a new snapshot
// inside its own transaction before deciding whether to insert one.
pub async fn latest_measurement(
    tx: &mut sqlx::PgTransaction<'_>,
    customer_id: Uuid,
) -> Result<Option<(Uuid, CreateMeasurementInput)>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            id, measurement_date, type, fit,
            front_height::float8, back_height::float8, chest::float8, waist::float8,
            hip::float8, shoulder::float8, shoulder_down::float8,
            sleeve_length::float8, neck_size::float8, open_hand::float8,
            open_hand_folding::float8, chest_up::float8,
            cuff_width::float8, cuff_size::float8, neck_width::float8, armhole::float8,
            fo_width::float8, fo::float8, bottom::float8, bottom_fold::float8,
            full_body::float8, sleeve_half::float8,
            open_fold::float8, front_pocket_length::float8,
            front_pocket_length_by_width,
            side_pocket::float8, side_pocket_length_by_width,
            mobile_pocket_length_by_width
        FROM measurements
        WHERE customer_id = $1
        ORDER BY measurement_date DESC, id DESC
        LIMIT 1
        "#,
        customer_id,
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(|row| {
        (
            row.id,
            CreateMeasurementInput {
                date: row.measurement_date,
                r#type: row.r#type,
                fit: row.fit,
                front_height: row.front_height,
                back_height: row.back_height,
                chest: row.chest,
                waist: row.waist,
                hip: row.hip,
                shoulder: row.shoulder,
                shoulder_down: row.shoulder_down,
                sleeve_length: row.sleeve_length,
                neck_size: row.neck_size,
                open_hand: row.open_hand,
                open_hand_folding: row.open_hand_folding,
                chest_up: row.chest_up,
                cuff_width: row.cuff_width,
                cuff_size: row.cuff_size,
                neck_width: row.neck_width,
                armhole: row.armhole,
                fo_width: row.fo_width,
                fo: row.fo,
                bottom: row.bottom,
                bottom_fold: row.bottom_fold,
                full_body: row.full_body,
                sleeve_half: row.sleeve_half,
                open_fold: row.open_fold,
                front_pocket_length: row.front_pocket_length,
                front_pocket_length_by_width: row.front_pocket_length_by_width,
                side_pocket: row.side_pocket,
                side_pocket_length_by_width: row.side_pocket_length_by_width,
                mobile_pocket_length_by_width: row.mobile_pocket_length_by_width,
            },
        )
    }))
}

// Tx-scoped so the invoices feature can create new customers as part of an
// invoice's transaction.
pub async fn insert_customer(
    tx: &mut sqlx::PgTransaction<'_>,
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
    .fetch_one(&mut **tx)
    .await
}

pub async fn create_customer(
    state: &AppState,
    name: &str,
    mobile_no: &str,
    measurement: Option<&CreateMeasurementInput>,
) -> Result<Uuid, sqlx::Error> {
    let mut tx = state.db().begin().await?;

    let customer_id = insert_customer(&mut tx, name, mobile_no).await?;

    if let Some(measurement) = measurement {
        insert_measurement(&mut tx, customer_id, measurement).await?;
    }

    tx.commit().await?;

    Ok(customer_id)
}

// COALESCE leaves any field the caller omitted untouched, so a partial update
// stays a single statement rather than a read-modify-write. The full customer
// (with its measurements JSON) is re-read through the list SPEC afterwards,
// since `RETURNING` alone can't build that projection.
pub async fn update_customer(
    state: &AppState,
    customer_id: Uuid,
    name: Option<&str>,
    mobile_no: Option<&str>,
) -> Result<Option<Customer>, AppError> {
    let updated = sqlx::query_scalar!(
        r#"
        UPDATE customers
        SET name = COALESCE($2, name),
            mobile_no = COALESCE($3, mobile_no)
        WHERE id = $1
        RETURNING id
        "#,
        customer_id,
        name,
        mobile_no,
    )
    .fetch_optional(state.db())
    .await?;

    if updated.is_none() {
        return Ok(None);
    }

    get_customer(state, customer_id).await
}
