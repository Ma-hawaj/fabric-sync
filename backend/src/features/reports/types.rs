use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosingQuery {
    pub date: Option<NaiveDate>,
    pub branch_id: Uuid,
}

pub struct ActivityRow {
    pub branch_id: Option<Uuid>,
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_number: i64,
    pub occurred_at: DateTime<Utc>,
    pub kind: String,
    pub method: Option<String>,
    pub amount_cents: i64,
    pub taxable_cents: i64,
    pub vat_cents: i64,
    pub gift_sales_cents: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_number: i64,
    pub occurred_at: DateTime<Utc>,
    pub kind: String,
    pub method: Option<String>,
    pub amount: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosingSummary {
    pub unrecorded_method_count: usize,
    pub invoice_count: usize,
    pub invoice_total: f64,
    pub taxable_amount: f64,
    pub vat_amount: f64,
    pub gift_card_sales: f64,
    pub credits: f64,
    pub net_invoice_activity: f64,
    pub invoice_payments: f64,
    pub repair_payments: f64,
    pub external_refunds: f64,
    pub net_external_receipts: f64,
    pub gift_card_redemptions: f64,
    pub gift_card_refunds: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenderSummary {
    pub method: String,
    pub invoice_payments: f64,
    pub repair_payments: f64,
    pub refunds: f64,
    pub net: f64,
    #[serde(default)]
    pub expenses: f64,
    #[serde(default)]
    pub after_expenses: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesClosing {
    #[serde(default)]
    pub closure: Option<DayClosure>,
    #[serde(default)]
    pub business_date: Option<NaiveDate>,
    #[serde(default)]
    pub previous_unclosed_date: Option<NaiveDate>,
    #[serde(default)]
    pub opening: Option<CashOpening>,
    #[serde(default)]
    pub expenses: Vec<BranchExpense>,
    pub unassigned_activity_count: usize,
    pub branch_id: Uuid,
    pub branch_name: String,
    pub fingerprint: String,
    pub last_check: Option<ClosingCheck>,
    pub date: NaiveDate,
    pub timezone: String,
    pub generated_at: DateTime<Utc>,
    pub summary: ClosingSummary,
    pub tenders: Vec<TenderSummary>,
    pub activity: Vec<Activity>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosingCounts {
    pub branch_activity_confirmed: bool,
    pub opening_cash: f64,
    pub cash_added: f64,
    pub cash_removed: f64,
    pub actual_cash: f64,
    pub actual_benefit: f64,
    pub actual_card: f64,
    pub notes: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonLine {
    pub method: String,
    pub recorded: f64,
    pub expected: f64,
    pub actual: f64,
    pub difference: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub matched: bool,
    pub unresolved_methods: usize,
    pub lines: Vec<ComparisonLine>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosingCheck {
    pub id: Uuid,
    pub checked_at: DateTime<Utc>,
    pub fingerprint: String,
    pub counts: ClosingCounts,
    pub comparison: Comparison,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveClosingInput {
    pub request_id: Uuid,
    pub branch_id: Uuid,
    pub date: NaiveDate,
    pub fingerprint: String,
    pub counts: ClosingCounts,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashOpening {
    pub id: Uuid,
    pub amount: f64,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub notes: String,
    pub supersedes_id: Option<Uuid>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchExpense {
    pub id: Uuid,
    pub amount: f64,
    pub payment_type: String,
    pub reason: String,
    pub paid_to: String,
    pub reference: String,
    pub recorded_at: DateTime<Utc>,
    pub recorded_by: String,
    pub voided_at: Option<DateTime<Utc>>,
    pub void_reason: Option<String>,
    pub voided_by: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveOpeningInput {
    pub request_id: Uuid,
    pub branch_id: Uuid,
    pub date: NaiveDate,
    pub amount: f64,
    #[serde(default)]
    pub notes: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordExpenseInput {
    pub request_id: Uuid,
    pub branch_id: Uuid,
    pub date: NaiveDate,
    pub amount: f64,
    pub payment_type: crate::features::invoices::types::PaymentType,
    pub reason: String,
    #[serde(default)]
    pub paid_to: String,
    #[serde(default)]
    pub reference: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoidExpenseInput {
    pub request_id: Uuid,
    pub reason: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayClosure {
    pub id: Uuid,
    pub check_id: Uuid,
    pub closed_at: DateTime<Utc>,
    pub closed_by: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseDayInput {
    pub request_id: Uuid,
    pub branch_id: Uuid,
    pub date: NaiveDate,
    pub check_id: Uuid,
    pub fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchDayStatus {
    pub branch_id: Uuid,
    pub date: NaiveDate,
    pub opening_recorded: bool,
    pub closed: bool,
    pub previous_unclosed_date: Option<NaiveDate>,
    pub can_create_orders: bool,
}
