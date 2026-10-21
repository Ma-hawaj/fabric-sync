use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: Uuid,
    pub name: String,
    pub mobile_no: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    pub mobile: String,
    pub customers: Vec<Customer>,
    pub excluded_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub invoice_number: i64,
    pub source_hash: String,
    pub revision: i64,
    pub messages: Vec<MessageSnapshot>,
    pub exclusions: Vec<Destination>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSnapshot {
    pub body: String,
    pub template_name: String,
    pub language: String,
    pub parameters: Vec<String>,
    pub attach_invoice: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareInput {
    pub kind: String,
    pub request_id: Uuid,
    pub resend_of: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInput {
    pub preview_version: Uuid,
    pub selected_mobiles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResendInput {
    pub request_id: Uuid,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Recipient {
    pub id: Uuid,
    pub normalized_mobile: String,
    #[sqlx(json)]
    pub customers: Value,
    pub selected: bool,
    pub status: String,
    pub error_message: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    #[sqlx(json)]
    pub messages: Value,
}

#[derive(Clone, Debug, FromRow)]
pub struct NotificationRow {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub kind: String,
    pub state: String,
    pub source_hash: String,
    pub preview_version: Uuid,
    #[sqlx(json)]
    pub snapshot: Snapshot,
    pub artifact_id: Option<Uuid>,
    pub resend_of: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub kind: String,
    pub state: String,
    pub preview_version: Uuid,
    pub snapshot: Snapshot,
    pub artifact_id: Option<Uuid>,
    pub recipients: Vec<Recipient>,
    pub created_at: DateTime<Utc>,
    pub can_send: bool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub id: Uuid,
    pub kind: String,
    pub state: String,
    pub created_at: DateTime<Utc>,
    pub send_count: i64,
    pub recipient_count: i64,
    pub queued_count: i64,
    pub accepted_count: i64,
    pub delivered_count: i64,
    pub failed_count: i64,
    pub uncertain_count: i64,
    pub cancelled_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub filename: String,
    pub mime_type: String,
    pub sha256: String,
    pub byte_length: i64,
    pub created_at: DateTime<Utc>,
}
