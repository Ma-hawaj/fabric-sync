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
    #[serde(deserialize_with = "Option::<Uuid>::deserialize")]
    pub default_location_id: Option<Uuid>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn default_location_key_is_required() {
        for value in [json!({}), json!({ "defaultLocatonId": null })] {
            let error = serde_json::from_value::<UpdatePreferencesInput>(value).unwrap_err();
            assert!(error
                .to_string()
                .contains("missing field `defaultLocationId`"));
        }
    }

    #[test]
    fn default_location_accepts_null_and_uuid() {
        let cleared: UpdatePreferencesInput =
            serde_json::from_value(json!({ "defaultLocationId": null })).unwrap();
        assert_eq!(cleared.default_location_id, None);

        let id = Uuid::new_v4();
        let selected: UpdatePreferencesInput =
            serde_json::from_value(json!({ "defaultLocationId": id })).unwrap();
        assert_eq!(selected.default_location_id, Some(id));
    }
}
