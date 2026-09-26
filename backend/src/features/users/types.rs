use serde::Serialize;

/// A person who can be assigned work — an order stage, eventually. `id` is a
/// plain string rather than a `Uuid` because it is meant to hold an Authentik
/// user UUID once this is backed by the real user directory, not an id this
/// app generates itself. `avatar_url` is whatever Authentik's `avatar` field
/// carries (an `http(s)` URL or a `data:` URI); `roles` and `groups` hold
/// the names of the Authentik roles and groups assigned to the user.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub roles: Vec<String>,
    pub groups: Vec<String>,
}
