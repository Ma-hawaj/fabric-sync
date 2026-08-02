use serde::Serialize;

/// A person who can be assigned work — an order stage, eventually. `id` is a
/// plain string rather than a `Uuid` because it is meant to hold a Zitadel
/// subject once this is backed by the real user directory, not an id this
/// app generates itself.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
}
