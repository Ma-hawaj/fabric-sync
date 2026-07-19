use crate::state::AppState;

use super::types::OrderListItem;

pub async fn list_orders(state: &AppState) -> Result<Vec<OrderListItem>, sqlx::Error> {
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
            o.price::float8 AS "price!"
        FROM orders o
        JOIN invoices i ON i.id = o.invoice_id
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
        ORDER BY o.id DESC
        "#,
    )
    .fetch_all(state.db())
    .await
}
