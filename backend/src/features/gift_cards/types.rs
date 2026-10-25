use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GiftCard {
    pub id: Uuid,
    pub code: String,
    pub initial_amount: f64,
    /// What is left to spend. Decremented across invoices, so it outlives the
    /// sale that created the card.
    pub balance: f64,
    pub customer_id: Option<Uuid>,
    pub customer_name: Option<String>,
    pub bought_for: Option<String>,
    pub recipient_phone: Option<String>,
    pub delivery_status: Option<String>,
    pub delivery_error: Option<String>,
    pub expires_on: Option<NaiveDate>,
    pub is_active: bool,
}

/// Just enough of a card to decide whether it can be redeemed. Read under a row
/// lock during invoice creation, so it deliberately carries no display fields.
#[derive(Clone, Debug)]
pub struct GiftCardBalance {
    pub id: Uuid,
    pub balance: f64,
    pub is_active: bool,
    pub expires_on: Option<NaiveDate>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGiftCardInput {
    pub amount: f64,
    #[serde(default)]
    pub bought_for: Option<String>,
    pub recipient_phone: String,
    #[serde(default)]
    pub customer_id: Option<Uuid>,
    #[serde(default)]
    pub expires_on: Option<NaiveDate>,
}

/// Recipient details can be corrected without changing the card's code or value.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGiftCardInput {
    pub is_active: Option<bool>,
    pub bought_for: Option<String>,
    pub recipient_phone: Option<String>,
}
