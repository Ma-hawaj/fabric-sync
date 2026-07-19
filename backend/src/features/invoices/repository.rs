use uuid::Uuid;

use super::types::{CreateInvoiceInput, CreateOrderInput, DiscountUnit};

pub async fn insert_invoice(
    tx: &mut sqlx::PgTransaction<'_>,
    input: &CreateInvoiceInput,
    total_price: f64,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO invoices (
            invoice_date, branch_id, discount, discount_unit,
            payment_status, amount_paid, total_price
        )
        VALUES ($1, $2, $3::float8, $4, $5, $6::float8, $7::float8)
        RETURNING id
        "#,
        input.date,
        input.branch_id,
        input.discount,
        match input.discount_unit {
            DiscountUnit::Sar => "SAR",
            DiscountUnit::Percent => "%",
        },
        input.payment_status.as_str(),
        input.amount_paid,
        total_price,
    )
    .fetch_one(&mut **tx)
    .await
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
