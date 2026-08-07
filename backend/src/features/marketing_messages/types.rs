use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// The repository builds this JSON directly with camelCase keys (via
// jsonb_build_object), unlike customers::types::Measurement's to_jsonb(row)
// decode — so one ordinary rename_all covers both directions here.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignRecipient {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub customer_name: String,
    pub mobile_no: String,
    pub status: String,
    pub error_message: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: Uuid,
    pub body: String,
    pub template_name: String,
    pub created_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub recipients: Vec<CampaignRecipient>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampaignInput {
    pub body: String,
    pub recipient_customer_ids: Vec<Uuid>,
}
