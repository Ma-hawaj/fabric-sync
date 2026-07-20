use chrono::NaiveDate;
use serde::Serialize;
use uuid::Uuid;

// One row of GET /orders — an order line joined with its invoice, customer,
// and material for the orders list page.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderListItem {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_date: NaiveDate,
    pub measurement_id: Uuid,
    pub customer_name: String,
    pub customer_mobile: String,
    pub material: String,
    pub material_amount: f64,
    pub price: f64,
}
