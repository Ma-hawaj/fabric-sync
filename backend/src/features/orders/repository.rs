use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::Order;

async fn fetch_orders(state: &AppState, order_id: Option<Uuid>) -> Result<Vec<Order>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            json_build_object(
                'id', o.id,
                'invoiceId', o.invoice_id,
                'invoiceDate', i.created_at,
                'customerId', c.id,
                'customerName', c.name,
                'customerMobile', c.mobile_no,
                'measurementId', o.measurement_id,
                'materialName', mat.name,
                'status', o.status,
                'price', o.price::float8,
                'invoiceTotalPrice', i.total_price::float8,
                'invoiceAmountPaid', i.amount_paid::float8,
                'invoicePaymentStatus', i.payment_status
            ) AS "order!: Json<Order>"
        FROM orders o
        JOIN invoices i ON i.id = o.invoice_id
        JOIN measurements me ON me.id = o.measurement_id
        JOIN customers c ON c.id = me.customer_id
        JOIN materials mat ON mat.id = o.material_id
        WHERE $1::uuid IS NULL OR o.id = $1
        ORDER BY o.id
        "#,
        order_id,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows.into_iter().map(|row| row.order.0).collect())
}

pub async fn list_orders(state: &AppState) -> Result<Vec<Order>, sqlx::Error> {
    fetch_orders(state, None).await
}

pub async fn get_order(state: &AppState, order_id: Uuid) -> Result<Option<Order>, sqlx::Error> {
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

pub async fn mark_invoice_paid(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE invoices
        SET amount_paid = total_price, payment_status = 'paid'
        WHERE id = $1
        "#,
        invoice_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
