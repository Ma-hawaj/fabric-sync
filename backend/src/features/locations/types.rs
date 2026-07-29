use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: Uuid,
    pub name: String,
    /// A location customers collect finished orders from — a branch.
    pub receives_orders: bool,
    /// A location material stock is held at — a store.
    pub holds_stock: bool,
    pub is_active: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocationInput {
    pub name: String,
    #[serde(default = "default_true")]
    pub receives_orders: bool,
    #[serde(default = "default_true")]
    pub holds_stock: bool,
}

/// Every field is optional so the same endpoint serves the edit form (which
/// sends all of them) and the list page's deactivate action (which sends only
/// `isActive`).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLocationInput {
    pub name: Option<String>,
    pub receives_orders: Option<bool>,
    pub holds_stock: Option<bool>,
    pub is_active: Option<bool>,
}
