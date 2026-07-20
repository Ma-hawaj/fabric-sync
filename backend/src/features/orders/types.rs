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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentType {
    Benefit,
    Cash,
    Card,
}

impl PaymentType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Benefit => "benefit",
            Self::Cash => "cash",
            Self::Card => "card",
        }
    }
}

// Built explicitly with `json_build_object` in repository.rs (rather than
// `to_jsonb` over a whole row), so the JSON keys are already camelCase and
// this can use a single symmetric rename_all — same pattern as Material.
//
// An invoice is settled in up to two payments: an advance taken up front (at
// invoice creation) and a final payment that clears the remaining balance
// (when the order is received) — each may use a different payment method,
// hence the separate `*PaymentType` fields rather than one shared one.
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
    pub invoice_advance_amount: f64,
    pub invoice_advance_payment_type: Option<PaymentType>,
    pub invoice_final_payment_type: Option<PaymentType>,
}

/// Body for `POST /orders/:id/receive` — the payment method used for the
/// final payment that settles the invoice's remaining balance.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveOrderInput {
    pub payment_type: PaymentType,
}
