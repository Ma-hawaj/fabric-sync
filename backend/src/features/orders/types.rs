use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use crate::features::invoices::types::PaymentType;

/// What a checklist entry can be set to. `Pending` is not a stored value — it
/// deletes the progress row, which is how a stage ticked by mistake is undone.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    Pending,
    Done,
    Skipped,
}

impl StageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Done => "done",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepairStatus {
    Open,
    InProgress,
    Completed,
    Cancelled,
}

impl RepairStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// One row of the live `order_stages` catalog, in the shape the checklist
/// assembly needs. Distinct from `order_stages::types::OrderStage`, which is
/// that feature's API response.
#[derive(Clone, Debug)]
pub struct StageRow {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub requires_delivery: bool,
    pub is_active: bool,
}

/// A recorded stage action, flat as it comes out of the database. `repair_id`
/// is `None` for the original build and carries a repair's id for its rework
/// pass.
#[derive(Clone, Debug)]
pub struct ProgressRow {
    pub order_id: Uuid,
    pub repair_id: Option<Uuid>,
    pub stage_id: Uuid,
    pub status: String,
    pub completed_at: DateTime<Utc>,
    pub location_id: Option<Uuid>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RepairRow {
    pub id: Uuid,
    pub order_id: Uuid,
    pub reason: String,
    pub reported_on: NaiveDate,
    pub charge: f64,
    pub status: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
}

/// An order as the list query returns it, before the checklist and repairs are
/// assembled onto it.
#[derive(Clone, Debug)]
pub struct OrderRow {
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
    pub production_location_id: Option<Uuid>,
    pub production_location: Option<String>,
    pub receiving_location_id: Option<Uuid>,
    pub receiving_location: Option<String>,
    pub invoice_total_price: f64,
    pub invoice_amount_paid: f64,
    pub invoice_payment_status: String,
    pub invoice_advance_amount: f64,
    pub invoice_advance_payment_type: Option<String>,
    pub invoice_final_payment_type: Option<String>,
}

/// One entry of an assembled checklist: a stage from the catalog plus whatever
/// has been recorded against it on this pass.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderStageEntry {
    pub stage_id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub requires_delivery: bool,
    /// False when a delivery stage doesn't apply to this order because the
    /// garment is produced where the customer collects it. An entry that isn't
    /// applicable never blocks the order.
    pub applicable: bool,
    /// `"pending"`, `"done"`, or `"skipped"`.
    pub status: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub location_id: Option<Uuid>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderRepair {
    pub id: Uuid,
    pub reason: String,
    pub reported_on: NaiveDate,
    pub charge: f64,
    pub status: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub notes: Option<String>,
    /// The repair's own pass through the checklist, independent of the build's.
    pub stages: Vec<OrderStageEntry>,
    pub current_stage: Option<String>,
}

// One row of GET /orders — an order line joined with its invoice, customer,
// and material for the orders list page, plus the invoice's payment state so
// the page can show balance due and settle it via receive_order, and the
// production checklist and repair history for the tracking sheet.
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
    /// Where the garment is made. Only when this differs from the receiving
    /// location does a delivery stage apply.
    pub production_location_id: Option<Uuid>,
    pub production_location: Option<String>,
    /// Where the customer collects, taken from the invoice's branch.
    pub receiving_location_id: Option<Uuid>,
    pub receiving_location: Option<String>,
    pub stages: Vec<OrderStageEntry>,
    /// Name of the first applicable stage still outstanding, or `None` once the
    /// build is finished.
    pub current_stage: Option<String>,
    pub repairs: Vec<OrderRepair>,
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

/// Only the production location is editable on an order; everything else is
/// fixed by the invoice that created it.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOrderInput {
    pub production_location_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetStageInput {
    pub status: StageStatus,
    /// Omitted to act on the original build, set to act on a repair's pass.
    pub repair_id: Option<Uuid>,
    /// Where a delivery stage delivered to. Required when completing a stage
    /// that needs a delivery.
    pub location_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRepairInput {
    pub reason: String,
    #[serde(default)]
    pub charge: f64,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRepairInput {
    pub reason: Option<String>,
    pub charge: Option<f64>,
    pub status: Option<RepairStatus>,
    pub notes: Option<String>,
}
