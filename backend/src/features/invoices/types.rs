use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::features::customers::types::CreateMeasurementInput;

// Deliberately not tied to a specific currency code — a flat amount in
// whatever the business currency is, or a percentage of the subtotal.
#[derive(Clone, Copy, Debug, Deserialize)]
pub enum DiscountUnit {
    #[serde(rename = "amount")]
    Amount,
    #[serde(rename = "percent")]
    Percent,
}

impl DiscountUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Amount => "amount",
            Self::Percent => "percent",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaymentStatus {
    Unpaid,
    Partial,
    Paid,
}

impl PaymentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unpaid => "unpaid",
            Self::Partial => "partial",
            Self::Paid => "paid",
        }
    }
}

// How a payment was actually made. An invoice can be settled in up to two
// payments — an advance taken at invoice creation and a final payment made
// when the order is received (see features::orders) — each recording its own
// `PaymentType`.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    pub material_id: Uuid,
    pub material_amount: f64,
    // Entered by staff per order line; materials carry no unit price to derive
    // it from.
    pub price: f64,
    pub thobe_type: Option<String>,
    pub f_pocket: Option<String>,
    pub collar: Option<String>,
    pub sleeve: Option<String>,
    pub patti: Option<String>,
    pub more_details: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCustomerInput {
    pub name: String,
    pub mobile_no: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceCustomerInput {
    // Exactly one of these two must be set: reference an existing customer or
    // create a new one as part of the invoice.
    #[serde(default)]
    pub existing_customer_id: Option<Uuid>,
    #[serde(default)]
    pub new_customer: Option<NewCustomerInput>,
    // Saving an invoice always records a fresh measurement snapshot (orders
    // reference it), even when every field was left blank.
    pub measurement: CreateMeasurementInput,
    pub orders: Vec<CreateOrderInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceInput {
    pub date: NaiveDate,
    #[serde(default)]
    pub branch_id: Option<Uuid>,
    #[serde(default)]
    pub discount: f64,
    pub discount_unit: DiscountUnit,
    pub payment_status: PaymentStatus,
    #[serde(default)]
    pub amount_paid: f64,
    // The method used for the advance payment above. Required whenever
    // amount_paid is greater than zero (validated in service.rs).
    #[serde(default)]
    pub payment_type: Option<PaymentType>,
    pub customers: Vec<InvoiceCustomerInput>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvoice {
    pub id: Uuid,
    pub total_price: f64,
}

// One row of GET /invoices. Deserialize is only used to decode the
// SQL-built JSON aggregate in repository.rs, whose keys are already
// camelCase, so a single symmetric rename_all works.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceListCustomer {
    pub name: String,
    pub mobile_no: String,
}

/// Body for `POST /invoices/:id/receive` — marks every order on the invoice
/// received and settles the remaining balance in one action, for when the
/// customer collects everything (and pays) at once rather than picking up
/// order lines individually (see features::orders::receive_order).
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveInvoiceInput {
    pub payment_type: PaymentType,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedInvoice {
    pub id: Uuid,
    pub payment_status: String,
    pub amount_paid: f64,
    pub final_payment_type: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceListItem {
    pub id: Uuid,
    pub date: NaiveDate,
    pub customers: Vec<InvoiceListCustomer>,
    pub item_count: i64,
    pub materials: Vec<String>,
    pub total_price: f64,
    pub payment_status: String,
    pub amount_paid: f64,
    pub advance_amount: f64,
    pub advance_payment_type: Option<String>,
    pub final_payment_type: Option<String>,
}
