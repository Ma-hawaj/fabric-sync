use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::features::invoices::types::PaymentType;

// One row of GET /orders — an order line joined with its invoice, customer,
// and material for the orders list page, plus the invoice's payment state so
// the page can show balance due and settle it via receive_order below.
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
    pub status: String,
    pub invoice_total_price: f64,
    pub invoice_amount_paid: f64,
    pub invoice_payment_status: String,
    pub invoice_advance_amount: f64,
    pub invoice_advance_payment_type: Option<String>,
    pub invoice_final_payment_type: Option<String>,
}

/// Body for `POST /orders/:id/receive` — the payment method used for the
/// final payment that settles the invoice's remaining balance.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveOrderInput {
    pub payment_type: PaymentType,
}
