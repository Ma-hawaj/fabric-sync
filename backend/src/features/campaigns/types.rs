use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudienceCount {
    pub message_count: usize,
    pub matching_customers: usize,
    pub excluded_customers: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudienceFilter {
    pub last_purchase_from: Option<NaiveDate>,
    pub last_purchase_to: Option<NaiveDate>,
    #[serde(default)]
    pub never_purchased: bool,
    pub min_purchases: Option<i64>,
    pub max_purchases: Option<i64>,
    // Decimal strings keep financial filter bounds out of binary float arithmetic.
    pub min_spend: Option<String>,
    pub max_spend: Option<String>,
    pub branch_id: Option<Uuid>,
    #[serde(default)]
    pub excluded_customer_ids: Vec<Uuid>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateDefinition {
    pub body: String,
    #[serde(default)]
    pub examples: Vec<String>,
    pub footer: Option<String>,
    #[serde(default)]
    pub image_header: bool,
    pub sample_asset_id: Option<Uuid>,
    pub website_label: Option<String>,
    pub website_url: Option<String>,
    pub unsubscribe_label: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateInput {
    pub name: String,
    pub language: String,
    pub definition: TemplateDefinition,
    pub expected_revision: Option<Uuid>,
}
#[derive(Clone, Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: Uuid,
    pub revision: Uuid,
    pub name: String,
    pub language: String,
    #[sqlx(json)]
    pub definition: TemplateDefinition,
    pub state: String,
    pub provider_id: Option<String>,
    pub rejection_reason: Option<String>,
    pub archived: bool,
    pub synced_at: Option<DateTime<Utc>>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampaignInput {
    pub name: String,
    pub template_id: Uuid,
    pub parameters: Vec<String>,
    pub asset_id: Option<Uuid>,
    #[serde(default)]
    pub audience: AudienceFilter,
    pub send_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub expected_revision: Option<Uuid>,
}
#[derive(Clone, Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: Uuid,
    pub revision: Uuid,
    pub name: String,
    #[sqlx(json)]
    pub definition: CampaignInput,
    pub state: String,
    pub preview_version: Option<Uuid>,
    pub preview: Option<Value>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub send_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub blocked_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Clone, Debug, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudienceCustomer {
    pub id: Uuid,
    pub name: String,
    pub mobile_no: String,
    pub purchase_count: i64,
    pub lifetime_spend: String,
    pub last_purchase: Option<DateTime<Utc>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    pub mobile: String,
    pub customers: Vec<AudienceCustomer>,
    pub consent_version: Option<Uuid>,
    pub excluded_reason: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub version: Uuid,
    pub revision: Uuid,
    pub template: TemplateSnapshot,
    pub body: String,
    pub parameters: Vec<String>,
    pub asset_id: Option<Uuid>,
    pub asset_sha256: Option<String>,
    pub send_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub destinations: Vec<Destination>,
    pub excluded: Vec<Destination>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSnapshot {
    pub id: Uuid,
    pub revision: Uuid,
    pub provider_id: Option<String>,
    pub name: String,
    pub language: String,
    pub definition: TemplateDefinition,
}
impl From<Template> for TemplateSnapshot {
    fn from(t: Template) -> Self {
        Self {
            id: t.id,
            revision: t.revision,
            provider_id: t.provider_id,
            name: t.name,
            language: t.language,
            definition: t.definition,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveInput {
    pub expected_revision: Uuid,
    pub preview_version: Uuid,
    pub request_id: Uuid,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConsentInput {
    pub expected_mobile: String,
    pub granted: bool,
    pub observed_at: DateTime<Utc>,
    pub source: String,
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Consent {
    pub mobile: String,
    pub granted: bool,
    pub version: Uuid,
    pub observed_at: DateTime<Utc>,
    pub source: String,
    pub recorded_by: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetInput {
    pub filename: String,
    pub mime_type: String,
    pub data_base64: String,
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: Uuid,
    pub filename: String,
    pub mime_type: String,
    pub sha256: String,
}
#[derive(Clone, FromRow)]
pub struct Job {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub mobile: String,
    pub attempt_count: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    #[serde(default = "one")]
    pub page: i64,
    #[serde(default = "fifty")]
    pub per_page: i64,
}
fn one() -> i64 {
    1
}
fn fifty() -> i64 {
    50
}
impl Pagination {
    pub fn limit(&self) -> i64 {
        self.per_page.clamp(1, 100)
    }
    pub fn offset(&self) -> i64 {
        (self.page.clamp(1, 1_000_000) - 1) * self.limit()
    }
}
