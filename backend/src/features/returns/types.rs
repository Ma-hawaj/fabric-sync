use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReturnLineInput {
    pub line_id: Uuid,
    pub quantity: f64,
    pub restock: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateReturnInput {
    pub request_id: Uuid,
    pub reason: String,
    pub lines: Vec<ReturnLineInput>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefundMethod {
    Benefit,
    Cash,
    Card,
    GiftCard,
}

impl RefundMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Benefit => "benefit",
            Self::Cash => "cash",
            Self::Card => "card",
            Self::GiftCard => "gift_card",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRefundInput {
    pub request_id: Uuid,
    pub reason: String,
    pub amount: f64,
    pub payment_type: RefundMethod,
    pub gift_card_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub amount_paid: f64,
    pub amount_credited: f64,
    pub cash_refunded: f64,
    pub gift_card_refunded: f64,
    pub net_total: f64,
    pub net_amount_paid: f64,
    pub net_gift_card_redeemed: f64,
    pub balance_due: f64,
    pub refund_due: f64,
    pub payment_status: String,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReturnableLine {
    pub line_id: Uuid,
    pub kind: String,
    pub description: String,
    /// One garment for tailoring, units sold for retail (never metres of fabric).
    pub quantity: f64,
    pub returned_quantity: f64,
    pub credited_amount: f64,
    pub line_total: f64,
    pub collected: bool,
    pub can_restock: bool,
    /// Deterministically allocated share of the discounted sale, in cents.
    pub credit_limit: f64,
    #[serde(skip)]
    pub product_id: Option<Uuid>,
    #[serde(skip)]
    pub branch_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReturnRecord {
    pub id: Uuid,
    pub reason: String,
    pub amount: f64,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub lines: sqlx::types::Json<Vec<ReturnedLine>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnedLine {
    pub description: String,
    pub quantity: f64,
    pub amount: f64,
    pub restocked: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RefundRecord {
    pub id: Uuid,
    pub reason: String,
    pub amount: f64,
    pub payment_type: String,
    pub gift_card_code: Option<String>,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RefundableCard {
    pub id: Uuid,
    pub code: String,
    pub refundable_amount: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReturnContext {
    pub settlement: Settlement,
    pub lines: Vec<ReturnableLine>,
    pub returns: Vec<ReturnRecord>,
    pub refunds: Vec<RefundRecord>,
    pub gift_cards: Vec<RefundableCard>,
}

#[derive(Serialize)]
pub struct RecordedAdjustment {
    pub id: Uuid,
}
