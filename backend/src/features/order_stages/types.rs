use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OrderStage {
    pub id: Uuid,
    pub name: String,
    /// Position in the checklist. Staff reorder the list by editing this, so
    /// values are not required to be contiguous — only the relative order
    /// matters.
    pub sort_order: i32,
    /// A stage that only applies when the garment changes location. On an order
    /// produced where the customer collects, it is reported as not applicable
    /// rather than left as an unfinished step.
    pub requires_delivery: bool,
    pub is_active: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderStageInput {
    pub name: String,
    pub sort_order: i32,
    #[serde(default)]
    pub requires_delivery: bool,
}

/// Every field is optional so the same endpoint serves the edit form (which
/// sends all of them) and the list page's activate/deactivate action (which
/// sends only `isActive`).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOrderStageInput {
    pub name: Option<String>,
    pub sort_order: Option<i32>,
    pub requires_delivery: Option<bool>,
    pub is_active: Option<bool>,
}
