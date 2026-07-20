use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderStatus {
    Pending,
    Received,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentStatus {
    Unpaid,
    Partial,
    Paid,
}

// Built explicitly with `json_build_object` in repository.rs (rather than
// `to_jsonb` over a whole row), so the JSON keys are already camelCase and
// this can use a single symmetric rename_all — same pattern as Material.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_date: DateTime<Utc>,
    pub customer_id: Uuid,
    pub customer_name: String,
    pub customer_mobile: String,
    pub measurement_id: Uuid,
    pub material_name: String,
    pub status: OrderStatus,
    pub price: f64,
    pub invoice_total_price: f64,
    pub invoice_amount_paid: f64,
    pub invoice_payment_status: PaymentStatus,
}
