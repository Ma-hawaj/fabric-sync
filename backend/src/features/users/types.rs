use serde::Serialize;

/// A person who can be assigned work — an order stage, eventually. `id` is a
/// plain string rather than a `Uuid` because it holds a Zitadel subject
/// (`userId`), not an id this app generates itself. `avatar_url` is whatever
/// Zitadel's `human.profile.avatarUrl` carries, passed straight through for
/// the frontend to render (it falls back to initials when missing or broken).
/// `roles` holds the user's project role keys (see `zitadel::user_roles`);
/// `groups` is always empty — Zitadel has no usable "groups of a user" API
/// (GroupService's member listing is still under development), so there is
/// nothing to fill it from. The field stays so the REST shape matches what
/// the Users table and assignee picker already render.
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
