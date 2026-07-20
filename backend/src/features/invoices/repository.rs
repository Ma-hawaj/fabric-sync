use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{
    CreateInvoiceInput, CreateOrderInput, InvoiceListCustomer, InvoiceListItem, PaymentType,
    ReceivedInvoice,
};

pub async fn list_invoices(state: &AppState) -> Result<Vec<InvoiceListItem>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            i.id,
            i.invoice_date,
            i.payment_status,
            i.total_price::float8 AS "total_price!",
            i.amount_paid::float8 AS "amount_paid!",
            i.advance_amount::float8 AS "advance_amount!",
            i.advance_payment_type,
            i.final_payment_type,
            COALESCE(agg.item_count, 0) AS "item_count!",
            COALESCE(agg.customers, '[]') AS "customers!: Json<Vec<InvoiceListCustomer>>",
            COALESCE(agg.materials, '[]') AS "materials!: Json<Vec<String>>"
        FROM invoices i
        LEFT JOIN LATERAL (
            SELECT
                count(*) AS item_count,
                json_agg(DISTINCT jsonb_build_object(
                    'name', c.name,
                    'mobileNo', c.mobile_no
                )) AS customers,
                json_agg(DISTINCT mat.name) AS materials
            FROM orders o
            JOIN measurements m ON m.id = o.measurement_id
            JOIN customers c ON c.id = m.customer_id
            JOIN materials mat ON mat.id = o.material_id
            WHERE o.invoice_id = i.id
        ) agg ON true
        ORDER BY i.id DESC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| InvoiceListItem {
            id: row.id,
            date: row.invoice_date,
            customers: row.customers.0,
            item_count: row.item_count,
            materials: row.materials.0,
            total_price: row.total_price,
            payment_status: row.payment_status,
            amount_paid: row.amount_paid,
            advance_amount: row.advance_amount,
            advance_payment_type: row.advance_payment_type,
            final_payment_type: row.final_payment_type,
        })
        .collect())
}

pub async fn insert_invoice(
    tx: &mut sqlx::PgTransaction<'_>,
    input: &CreateInvoiceInput,
    total_price: f64,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO invoices (
            invoice_date, branch_id, discount, discount_unit,
            payment_status, amount_paid, total_price,
            advance_amount, advance_payment_type
        )
        VALUES ($1, $2, $3::float8, $4, $5, $6::float8, $7::float8, $6::float8, $8)
        RETURNING id
        "#,
        input.date,
        input.branch_id,
        input.discount,
        input.discount_unit.as_str(),
        input.payment_status.as_str(),
        input.amount_paid,
        total_price,
        input.payment_type.map(super::types::PaymentType::as_str),
    )
    .fetch_one(&mut **tx)
    .await
}

/// Marks every order on the invoice received and settles the remaining
/// balance in full, recording how that final payment was made. Returns
/// `None` if the invoice doesn't exist.
pub async fn receive_invoice(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    final_payment_type: PaymentType,
) -> Result<Option<ReceivedInvoice>, sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE orders
        SET status = 'received', received_at = now()
        WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .execute(&mut **tx)
    .await?;

    let row = sqlx::query!(
        r#"
        UPDATE invoices
        SET amount_paid = total_price, payment_status = 'paid', final_payment_type = $2
        WHERE id = $1
        RETURNING id, payment_status, amount_paid::float8 AS "amount_paid!", final_payment_type
        "#,
        invoice_id,
        final_payment_type.as_str(),
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(|row| ReceivedInvoice {
        id: row.id,
        payment_status: row.payment_status,
        amount_paid: row.amount_paid,
        final_payment_type: row.final_payment_type,
    }))
}

pub async fn insert_order(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    measurement_id: Uuid,
    order: &CreateOrderInput,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO orders (
            measurement_id, material_id, material_amount, invoice_id, price,
            thobe_type, f_pocket, collar, sleeve, patti, more_details
        )
        VALUES ($1, $2, $3::float8, $4, $5::float8, $6, $7, $8, $9, $10, $11)
        "#,
        measurement_id,
        order.material_id,
        order.material_amount,
        invoice_id,
        order.price,
        order.thobe_type,
        order.f_pocket,
        order.collar,
        order.sleeve,
        order.patti,
        order.more_details,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
