use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The default location joined in for display, so the sidebar can render a
/// name without a second fetch. Same shape as the locations feature's
/// `Location` — duplicated rather than shared because that module keeps its
/// types private.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultLocation {
    pub id: Uuid,
    pub name: String,
    pub receives_orders: bool,
    pub holds_stock: bool,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub default_location_id: Option<Uuid>,
    pub default_location: Option<DefaultLocation>,
}

/// Nullable but required: `null` clears the default, a UUID sets it. There is
/// only one preference today, so partial-update semantics would just be noise;
// a future second preference can add its own optional field.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesInput {
    pub default_location_id: Option<Uuid>,
}
