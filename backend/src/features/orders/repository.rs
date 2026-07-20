use uuid::Uuid;

use crate::state::AppState;

use super::types::{OrderListItem, PaymentType};

async fn fetch_orders(
    state: &AppState,
    order_id: Option<Uuid>,
) -> Result<Vec<OrderListItem>, sqlx::Error> {
    sqlx::query_as!(
        OrderListItem,
        r#"
        SELECT
            o.id,
            o.invoice_id,
            i.invoice_date,
            o.measurement_id,
            c.name AS customer_name,
            c.mobile_no AS customer_mobile,
            mat.name AS material,
            o.material_amount::float8 AS "material_amount!",
            o.price::float8 AS "price!",
            o.status,
            i.total_price::float8 AS "invoice_total_price!",
            i.amount_paid::float8 AS "invoice_amount_paid!",
            i.payment_status AS invoice_payment_status,
            i.advance_amount::float8 AS "invoice_advance_amount!",
            i.advance_payment_type AS invoice_advance_payment_type,
            i.final_payment_type AS invoice_final_payment_type
        FROM orders o
        JOIN invoices i ON i.id = o.invoice_id
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
        WHERE $1::uuid IS NULL OR o.id = $1
        ORDER BY o.id DESC
        "#,
        order_id,
    )
    .fetch_all(state.db())
    .await
}

pub async fn list_orders(state: &AppState) -> Result<Vec<OrderListItem>, sqlx::Error> {
    fetch_orders(state, None).await
}

pub async fn get_order(
    state: &AppState,
    order_id: Uuid,
) -> Result<Option<OrderListItem>, sqlx::Error> {
    Ok(fetch_orders(state, Some(order_id)).await?.pop())
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
        SET amount_paid = total_price, payment_status = 'paid', final_payment_type = $2
        WHERE id = $1
        "#,
        invoice_id,
        final_payment_type.as_str(),
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
