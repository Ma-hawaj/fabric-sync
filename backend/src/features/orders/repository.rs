use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{AssignmentRow, OrderRow, PaymentType, ProgressRow, RepairRow, StageRow};

// `balance_due` and `payment_method` are shown as columns on the orders page
// and so have to be sortable and filterable; they are derived here rather
// than in the browser, which is the only place that can page over them.
//
// `current_stage` mirrors `stage_applies`/`assemble_stages`/
// `current_stage_name`, and the precedence of `currentStageLabel` in
// `frontend/src/features/orders/lib/order-tracking.ts`, so the Stage filter
// can run in the database instead of over every row in the browser: no
// applicable pending stage at all is 'Completed' (checked first, same as the
// frontend); otherwise no progress recorded yet is 'Not started'; otherwise
// the next stage's name. It intentionally computes its own effective
// production location (explicit `production_branch_id`, falling back to the
// single-stock-location inference) via a lateral subquery scoped to this
// expression alone — the plain `production_location_id`/`production_location`
// columns below stay the raw explicit-only join, unchanged, because
// `service::effective_production` still needs to tell an explicit assignment
// apart from an inferred one for display (`productionLocationInferred`). The
// two must not be conflated.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            o.id,
            o.invoice_id,
            i.invoice_date,
            o.measurement_id,
            c.name AS customer_name,
            c.mobile_no AS customer_mobile,
            mat.name AS material,
            o.material_id,
            o.material_amount::float8 AS material_amount,
            o.price::float8 AS price,
            o.status,
            o.production_branch_id AS production_location_id,
            prod.name AS production_location,
            i.branch_id AS receiving_location_id,
            recv.name AS receiving_location,
            i.total_price::float8 AS invoice_total_price,
            i.amount_paid::float8 AS invoice_amount_paid,
            i.payment_status AS invoice_payment_status,
            i.advance_amount::float8 AS invoice_advance_amount,
            i.advance_payment_type AS invoice_advance_payment_type,
            i.final_payment_type AS invoice_final_payment_type,
            GREATEST(i.total_price - i.amount_paid, 0)::float8 AS balance_due,
            COALESCE(i.final_payment_type, i.advance_payment_type) AS payment_method,
            CASE
                WHEN next_stage.name IS NULL THEN 'Completed'
                WHEN NOT EXISTS (
                    SELECT 1 FROM order_stage_progress p WHERE p.order_id = o.id
                ) THEN 'Not started'
                ELSE next_stage.name
            END AS current_stage
        FROM orders o
        JOIN invoices i ON i.id = o.invoice_id
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
        LEFT JOIN branch prod ON prod.id = o.production_branch_id
        LEFT JOIN branch recv ON recv.id = i.branch_id
        -- Single-stock-location inference, scoped to this order's material,
        -- for the `current_stage` expression only — mirrors
        -- `single_stock_locations`/`effective_production` in Rust.
        LEFT JOIN LATERAL (
            SELECT (array_agg(ms.branch_id))[1] AS branch_id
            FROM material_stock ms
            JOIN branch b ON b.id = ms.branch_id
            WHERE ms.material_id = o.material_id
              AND ms.quantity > 0
              AND b.is_active
              AND b.holds_stock
            GROUP BY ms.material_id
            HAVING COUNT(DISTINCT ms.branch_id) = 1
        ) inferred ON true
        -- The first active, applicable, not-yet-recorded stage — computed
        -- once here rather than repeated in the CASE above.
        LEFT JOIN LATERAL (
            SELECT s.name
            FROM order_stages s
            WHERE s.is_active
              AND NOT EXISTS (
                  SELECT 1 FROM order_stage_progress p2
                  WHERE p2.order_id = o.id AND p2.stage_id = s.id
              )
              AND (
                  NOT s.requires_delivery
                  OR (
                      COALESCE(o.production_branch_id, inferred.branch_id) IS NOT NULL
                      AND i.branch_id IS NOT NULL
                      AND COALESCE(o.production_branch_id, inferred.branch_id) <> i.branch_id
                  )
              )
            ORDER BY s.sort_order, s.name
            LIMIT 1
        ) next_stage ON true
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("invoiceId", ColumnDef::new("invoice_id", ColumnKind::Uuid)),
        (
            "invoiceDate",
            ColumnDef::new("invoice_date", ColumnKind::Date),
        ),
        (
            "customerName",
            ColumnDef::new("customer_name", ColumnKind::Text),
        ),
        (
            "customerMobile",
            ColumnDef::new("customer_mobile", ColumnKind::Text),
        ),
        ("material", ColumnDef::new("material", ColumnKind::Text)),
        (
            "materialAmount",
            ColumnDef::new("material_amount", ColumnKind::Number),
        ),
        ("price", ColumnDef::new("price", ColumnKind::Number)),
        ("status", ColumnDef::new("status", ColumnKind::Text)),
        (
            "invoicePaymentStatus",
            ColumnDef::new("invoice_payment_status", ColumnKind::Text),
        ),
        (
            "balanceDue",
            ColumnDef::new("balance_due", ColumnKind::Number),
        ),
        (
            "paymentMethod",
            ColumnDef::new("payment_method", ColumnKind::Text),
        ),
        ("stage", ColumnDef::new("current_stage", ColumnKind::Text)),
    ],
    default_order: "id DESC",
};

pub async fn list_orders(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<OrderRow>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn get_order(state: &AppState, order_id: Uuid) -> Result<Option<OrderRow>, AppError> {
    list::fetch_by_id(state.db(), &SPEC, order_id).await
}

/// Materials stocked at exactly one location that's actually usable (active,
/// holds stock, and has some quantity on hand) — the set a production location
/// can be safely inferred for. A material split across several qualifying
/// locations, or with none, is simply absent from the result; the caller falls
/// back to leaving it for staff to assign.
pub async fn single_stock_locations(
    state: &AppState,
    material_ids: &[Uuid],
) -> Result<Vec<(Uuid, Uuid, String)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            ms.material_id AS "material_id!",
            (array_agg(ms.branch_id))[1] AS "branch_id!",
            (array_agg(b.name))[1] AS "branch_name!"
        FROM material_stock ms
        JOIN branch b ON b.id = ms.branch_id
        WHERE ms.material_id = ANY($1)
          AND ms.quantity > 0
          AND b.is_active
          AND b.holds_stock
        GROUP BY ms.material_id
        HAVING COUNT(DISTINCT ms.branch_id) = 1
        "#,
        material_ids,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| (row.material_id, row.branch_id, row.branch_name))
        .collect())
}

/// The whole stage catalog, retired stages included — a stage completed before
/// it was retired still belongs on that order's checklist, and the assembly
/// decides which ones to keep.
pub async fn list_stage_catalog(state: &AppState) -> Result<Vec<StageRow>, sqlx::Error> {
    sqlx::query_as!(
        StageRow,
        r#"
        SELECT id, name, sort_order, requires_delivery, is_active
        FROM order_stages
        ORDER BY sort_order, name
        "#
    )
    .fetch_all(state.db())
    .await
}

/// Every recorded stage action for the given orders, flat. The checklist is
/// built by overlaying these onto the catalog, so nothing is stored for a stage
/// nobody has touched yet.
pub async fn list_progress(
    state: &AppState,
    order_ids: &[Uuid],
) -> Result<Vec<ProgressRow>, sqlx::Error> {
    sqlx::query_as!(
        ProgressRow,
        r#"
        SELECT
            p.order_id,
            p.stage_id,
            p.status,
            p.completed_at,
            p.location_id,
            b.name AS "location?",
            p.notes
        FROM order_stage_progress p
        LEFT JOIN branch b ON b.id = p.location_id
        WHERE p.order_id = ANY($1)
        "#,
        order_ids,
    )
    .fetch_all(state.db())
    .await
}

/// Every recorded assignment for the given orders, flat — independent of
/// `list_progress`, since a stage is assignable whether or not it's been done.
pub async fn list_assignments(
    state: &AppState,
    order_ids: &[Uuid],
) -> Result<Vec<AssignmentRow>, sqlx::Error> {
    sqlx::query_as!(
        AssignmentRow,
        r#"
        SELECT order_id, stage_id, assignee_id, assignee_name
        FROM order_stage_assignments
        WHERE order_id = ANY($1)
        "#,
        order_ids,
    )
    .fetch_all(state.db())
    .await
}

/// Assigns a stage, overwriting any previous assignee. `assignee_name` is
/// resolved by the caller against the user directory rather than trusted from
/// the client — see `orders/service.rs::set_assignee`.
pub async fn set_assignee(
    state: &AppState,
    order_id: Uuid,
    stage_id: Uuid,
    assignee_id: &str,
    assignee_name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO order_stage_assignments (order_id, stage_id, assignee_id, assignee_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (order_id, stage_id)
        DO UPDATE SET
            assignee_id = EXCLUDED.assignee_id,
            assignee_name = EXCLUDED.assignee_name,
            assigned_at = now()
        "#,
        order_id,
        stage_id,
        assignee_id,
        assignee_name,
    )
    .execute(state.db())
    .await?;

    Ok(())
}

pub async fn clear_assignee(
    state: &AppState,
    order_id: Uuid,
    stage_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM order_stage_assignments
        WHERE order_id = $1 AND stage_id = $2
        "#,
        order_id,
        stage_id,
    )
    .execute(state.db())
    .await?;

    Ok(())
}

pub async fn list_repairs(
    state: &AppState,
    order_ids: &[Uuid],
) -> Result<Vec<RepairRow>, sqlx::Error> {
    sqlx::query_as!(
        RepairRow,
        r#"
        SELECT
            id,
            order_id,
            reason,
            reported_on,
            charge::float8 AS "charge!",
            status,
            completed_at,
            notes
        FROM order_repairs
        WHERE order_id = ANY($1)
        ORDER BY id
        "#,
        order_ids,
    )
    .fetch_all(state.db())
    .await
}

/// Marks the order received and returns its `invoice_id`, or `None` if the
/// order doesn't exist.
pub async fn mark_received(
    tx: &mut sqlx::PgTransaction<'_>,
    order_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE orders
        SET status = 'received', received_at = now()
        WHERE id = $1
        RETURNING invoice_id
        "#,
        order_id,
    )
    .fetch_optional(&mut **tx)
    .await
}

/// True once every order on the invoice has been received — the point at
/// which the customer has collected everything, so the remaining balance is
/// considered settled.
pub async fn invoice_fully_received(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) FILTER (WHERE status <> 'received') = 0
        FROM orders
        WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await
    .map(|all_received| all_received.unwrap_or(false))
}

/// Settles the invoice's remaining balance in full and records how that
/// final payment was made.
pub async fn mark_invoice_paid(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    final_payment_type: PaymentType,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE invoices
        SET amount_paid = total_price - gift_card_redeemed,
            payment_status = 'paid',
            final_payment_type = $2
        WHERE id = $1
        "#,
        invoice_id,
        final_payment_type.as_str(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// COALESCE keeps the stored value when the caller omits the field, matching
/// the partial-update shape used across the other features. The flip side is
/// that a production location can be reassigned but not cleared back to NULL.
pub async fn update_order(
    state: &AppState,
    order_id: Uuid,
    production_location_id: Option<Uuid>,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE orders
        SET production_branch_id = COALESCE($2, production_branch_id)
        WHERE id = $1
        RETURNING id
        "#,
        order_id,
        production_location_id,
    )
    .fetch_optional(state.db())
    .await
}

/// Records a stage as done or skipped. The upsert leans on the unique index,
/// so re-recording a stage overwrites the previous entry rather than stacking
/// duplicates.
pub async fn set_stage(
    tx: &mut sqlx::PgTransaction<'_>,
    order_id: Uuid,
    stage_id: Uuid,
    status: &str,
    location_id: Option<Uuid>,
    notes: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO order_stage_progress (
            order_id, stage_id, status, location_id, notes
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (order_id, stage_id)
        DO UPDATE SET
            status = EXCLUDED.status,
            completed_at = now(),
            location_id = EXCLUDED.location_id,
            notes = EXCLUDED.notes
        "#,
        order_id,
        stage_id,
        status,
        location_id,
        notes,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Undoes a stage by removing its row, which puts it back to pending — the
/// checklist is derived, so an absent row *is* "not done yet".
pub async fn clear_stage(
    tx: &mut sqlx::PgTransaction<'_>,
    order_id: Uuid,
    stage_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM order_stage_progress
        WHERE order_id = $1 AND stage_id = $2
        "#,
        order_id,
        stage_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn order_exists(state: &AppState, order_id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM orders WHERE id = $1) AS "exists!""#,
        order_id,
    )
    .fetch_one(state.db())
    .await
}

/// Guards the repair endpoints: a repair belonging to another order must not be
/// addressable through this order's URL.
pub async fn repair_belongs_to_order(
    state: &AppState,
    repair_id: Uuid,
    order_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM order_repairs WHERE id = $1 AND order_id = $2
        ) AS "exists!"
        "#,
        repair_id,
        order_id,
    )
    .fetch_one(state.db())
    .await
}

pub async fn create_repair(
    state: &AppState,
    order_id: Uuid,
    reason: &str,
    charge: f64,
    notes: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO order_repairs (order_id, reason, charge, notes)
        VALUES ($1, $2, $3::float8, $4)
        RETURNING id
        "#,
        order_id,
        reason,
        charge,
        notes,
    )
    .fetch_one(state.db())
    .await
}

/// `completed_at` is written explicitly rather than COALESCEd, because moving a
/// repair back out of `completed` has to clear it — a stored timestamp must
/// never describe a repair that is open again. It is only touched when the
/// request actually changes the status.
pub async fn update_repair(
    state: &AppState,
    repair_id: Uuid,
    reason: Option<&str>,
    charge: Option<f64>,
    status: Option<&str>,
    notes: Option<&str>,
    completed_at: Option<DateTime<Utc>>,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE order_repairs
        SET reason = COALESCE($2, reason),
            charge = COALESCE($3::float8, charge),
            status = COALESCE($4, status),
            notes = COALESCE($5, notes),
            completed_at = CASE WHEN $4::text IS NULL THEN completed_at ELSE $6 END
        WHERE id = $1
        RETURNING id
        "#,
        repair_id,
        reason,
        charge,
        status,
        notes,
        completed_at,
    )
    .fetch_optional(state.db())
    .await
}
