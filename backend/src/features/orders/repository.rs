use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{OrderListItem, PaymentType};

// `balance_due` and `payment_method` are shown as columns on the orders page and
// so have to be sortable and filterable; they are derived here rather than in
// the browser, which is the only place that can page over them.
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
            o.material_amount::float8 AS material_amount,
            o.price::float8 AS price,
            o.status,
            i.total_price::float8 AS invoice_total_price,
            i.amount_paid::float8 AS invoice_amount_paid,
            i.payment_status AS invoice_payment_status,
            i.advance_amount::float8 AS invoice_advance_amount,
            i.advance_payment_type AS invoice_advance_payment_type,
            i.final_payment_type AS invoice_final_payment_type,
            GREATEST(i.total_price - i.amount_paid, 0)::float8 AS balance_due,
            COALESCE(i.final_payment_type, i.advance_payment_type) AS payment_method
        FROM orders o
        JOIN invoices i ON i.id = o.invoice_id
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
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
    ],
    default_order: "id DESC",
};

pub async fn list_orders(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<OrderListItem>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn get_order(
    state: &AppState,
    order_id: Uuid,
) -> Result<Option<OrderListItem>, AppError> {
    list::fetch_by_id(state.db(), &SPEC, order_id).await
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
