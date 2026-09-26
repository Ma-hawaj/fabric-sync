use reqwest;
use serde::Deserialize;

use crate::{config::Config, error::AppError};

use super::types::User;

/// Backs `list_users` with Authentik's core Users API (`GET
/// /api/v3/core/users/`) — Authentik's own admin API, not part of the OIDC
/// standard, so unlike `auth::TokenIntrospection` this is unapologetically
/// Authentik-specific. Authenticates with a static API token issued to a
/// service account (Directory > Tokens & App passwords in the admin UI),
/// separate from `oauth_client_id`/`secret`, which authenticate the
/// confidential OAuth2 provider used only to introspect end-user tokens.
/// The service account needs permission to view users (`view_user`) — there
/// is no way to check that from here, so a missing grant surfaces as a 500
/// from `list_users` (Authentik's API returns 403).
#[derive(Clone, Debug)]
pub struct AuthentikUserDirectory {
    api_base: String,
    api_token: String,
    http_client: reqwest::Client,
}

#[derive(Deserialize)]
struct ListUsersResponse {
    #[serde(default)]
    results: Vec<AuthentikUser>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
struct Pagination {
    #[serde(default)]
    next: Option<u32>,
}

#[derive(Deserialize)]
struct AuthentikUser {
    uuid: String,
    username: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    /// The user's avatar as Authentik computes it — either an `http(s)` URL
    /// or a `data:` URI (generated initials by default) — passed straight
    /// through for the frontend to render.
    #[serde(default)]
    avatar: Option<String>,
    /// `internal` / `external` / `service_account`, ...
    #[serde(default, rename = "type")]
    user_type: Option<String>,
    #[serde(default)]
    is_active: Option<bool>,
    /// Roles assigned to the user (`roles_obj` carries `{name, ...}` per
    /// role); only the names are kept.
    #[serde(default)]
    roles_obj: Vec<AuthentikRole>,
    /// Groups the user belongs to (`groups_obj` carries `{name, ...}` per
    /// group); only the names are kept.
    #[serde(default)]
    groups_obj: Vec<AuthentikGroup>,
}

#[derive(Deserialize)]
struct AuthentikRole {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct AuthentikGroup {
    #[serde(default)]
    name: String,
}

/// Service accounts are machine identities, and inactive users can't take
/// work — neither is someone a stage can be assigned to.
fn assignable_user(user: AuthentikUser) -> Option<User> {
    if user.user_type.as_deref() == Some("service_account") {
        return None;
    }
    if user.is_active == Some(false) {
        return None;
    }
    let name = user
        .name
        .filter(|name| !name.is_empty())
        .unwrap_or(user.username);
    let roles = user
        .roles_obj
        .into_iter()
        .map(|role| role.name)
        .filter(|name| !name.is_empty())
        .collect();
    let groups = user
        .groups_obj
        .into_iter()
        .map(|group| group.name)
        .filter(|name| !name.is_empty())
        .collect();

    Some(User {
        id: user.uuid,
        name,
        email: user.email,
        avatar_url: user.avatar,
        roles,
        groups,
    })
}

impl AuthentikUserDirectory {
    pub async fn discover(config: &Config) -> Result<Self, String> {
        let api_token = config
            .authentik_api_token
            .clone()
            .ok_or_else(|| "AUTHENTIK_API_TOKEN is not set".to_string())?;

        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("failed to build Authentik HTTP client: {error}"))?;

        Ok(Self {
            api_base: config.authentik_base_url.trim_end_matches('/').to_string(),
            api_token,
            http_client,
        })
    }

    pub async fn list_users(&self) -> Result<Vec<User>, AppError> {
        let mut users = Vec::new();
        let mut page = 1u32;
        // The picker serves a tailoring shop, not a directory of thousands —
        // 100 pages of 200 is a sanity cap against a misbehaving server, not
        // a limit anyone is expected to hit.
        for _ in 0..100 {
            let response = self
                .http_client
                .get(format!("{}/api/v3/core/users/", self.api_base))
                .bearer_auth(&self.api_token)
                .query(&[("page", page), ("page_size", 200)])
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|error| {
                    AppError::Authentik(format!("Authentik users request failed: {error}"))
                })?
                .json::<ListUsersResponse>()
                .await
                .map_err(|error| {
                    AppError::Authentik(format!(
                        "failed to parse Authentik users response: {error}"
                    ))
                })?;

            users.extend(response.results.into_iter().filter_map(assignable_user));

            match response.pagination.and_then(|pagination| pagination.next) {
                Some(next) if next != page => page = next,
                _ => break,
            }
        }

        Ok(users)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_name_over_username() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "ahmed.alsayed",
            "name": "Ahmed Al-Sayed",
            "type": "internal",
            "is_active": true
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.id, "123");
        assert_eq!(result.name, "Ahmed Al-Sayed");
    }

    #[test]
    fn passes_through_email_avatar_and_role_names() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "ahmed.alsayed",
            "name": "Ahmed Al-Sayed",
            "email": "ahmed@example.com",
            "avatar": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
            "type": "internal",
            "is_active": true,
            "roles_obj": [
                { "name": "Tailors", "uuid": "456" },
                { "name": "", "uuid": "789" }
            ],
            "groups_obj": [
                { "name": "Branch A", "pk": "abc" },
                { "name": "", "pk": "def" }
            ]
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.email.as_deref(), Some("ahmed@example.com"));
        assert_eq!(
            result.avatar_url.as_deref(),
            Some("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
        );
        assert_eq!(result.roles, vec!["Tailors".to_string()]);
        assert_eq!(result.groups, vec!["Branch A".to_string()]);
    }

    #[test]
    fn defaults_missing_contact_fields_to_empty() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "ahmed.alsayed",
            "type": "internal",
            "is_active": true
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.email, None);
        assert_eq!(result.avatar_url, None);
        assert!(result.roles.is_empty());
        assert!(result.groups.is_empty());
    }

    #[test]
    fn falls_back_to_username_when_name_missing() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "ahmed.alsayed",
            "type": "internal",
            "is_active": true
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.name, "ahmed.alsayed");
    }

    #[test]
    fn excludes_service_accounts() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "fabric-sync-backend",
            "name": "fabric-sync-backend",
            "type": "service_account",
            "is_active": true
        }))
        .unwrap();

        assert!(assignable_user(user).is_none());
    }

    #[test]
    fn excludes_inactive_users() {
        let user: AuthentikUser = serde_json::from_value(serde_json::json!({
            "uuid": "123",
            "username": "former.staff",
            "name": "Former Staff",
            "type": "internal",
            "is_active": false
        }))
        .unwrap();

        assert!(assignable_user(user).is_none());
    }
}
