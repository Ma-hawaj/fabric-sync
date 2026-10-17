use base64::Engine;
use reqwest;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::{config::Config, error::AppError};

use super::types::User;

/// Backs `list_users` with Zitadel's own v2 Users API — not part of the OIDC
/// standard, so unlike `auth::TokenIntrospection` this is unapologetically
/// Zitadel-specific. Authenticates as a dedicated machine user via the
/// client credentials grant; separate from `oauth_client_id`/`secret`, which
/// authenticate an API resource-server credential that has no grantable
/// directory-read permission of its own. The machine user needs an
/// org-level `ORG_USER_MANAGER` role granted to it in the Zitadel console —
/// there is no way to check that from here, so a missing grant surfaces as
/// a 500 from `list_users` (Zitadel's API returns a permission error).
///
/// Token exchange is done via raw reqwest rather than the `oauth2` crate's
/// `exchange_client_credentials()` because Zitadel returns `expires_in` as a
/// string (`"3600"`) rather than a number, which causes the crate's strict
/// serde deserialization to fail.
#[derive(Clone, Debug)]
pub struct ZitadelUserDirectory {
    client_id: String,
    client_secret: String,
    token_url: String,
    api_base: String,
    http_client: reqwest::Client,
}

#[derive(Serialize)]
struct SearchUsersRequest {
    query: SearchQuery,
    #[serde(rename = "sortingColumn")]
    sorting_column: &'static str,
}

#[derive(Serialize)]
struct SearchQuery {
    limit: u32,
    offset: u64,
    asc: bool,
}

#[derive(Deserialize)]
struct SearchUsersResponse {
    details: ListDetails,
    #[serde(default)]
    result: Vec<ZitadelUser>,
}

#[derive(Deserialize)]
struct ListDetails {
    // Protobuf JSON emits uint64 as strings, but also accepts JSON numbers.
    #[serde(
        default,
        rename = "totalResult",
        deserialize_with = "deserialize_total"
    )]
    total_result: u64,
}

fn deserialize_total<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Total {
        String(String),
        Number(u64),
    }
    match Total::deserialize(deserializer)? {
        Total::String(value) => value.parse().map_err(serde::de::Error::custom),
        Total::Number(value) => Ok(value),
    }
}

impl ListDetails {
    fn next_offset(&self, offset: u64, page_len: usize) -> Result<Option<u64>, AppError> {
        let next = offset + page_len as u64;
        if next >= self.total_result {
            Ok(None)
        } else if page_len == 0 {
            Err(AppError::Zitadel(
                "Zitadel returned an empty page before totalResult was reached".to_string(),
            ))
        } else {
            Ok(Some(next))
        }
    }
}

#[derive(Deserialize)]
struct ZitadelUser {
    #[serde(rename = "userId")]
    user_id: String,
    username: String,
    human: Option<ZitadelHuman>,
}

#[derive(Deserialize)]
struct ZitadelHuman {
    profile: Option<ZitadelProfile>,
    email: Option<ZitadelEmail>,
}

#[derive(Deserialize)]
struct ZitadelProfile {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(default, rename = "avatarUrl")]
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct ZitadelEmail {
    #[serde(default)]
    email: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

/// One page of the management v1 user-grants search
/// (`POST /management/v1/users/grants/_search`). Each grant ties a user to
/// project role keys; only the user id and the keys are kept. Everything
/// defaults except pagination details; a shape drift still degrades to
/// "no roles" through the best-effort enrichment error path.
#[derive(Deserialize)]
struct SearchGrantsResponse {
    details: ListDetails,
    #[serde(default)]
    result: Vec<ZitadelUserGrant>,
}

#[derive(Default, Deserialize)]
struct ZitadelUserGrant {
    #[serde(default, rename = "userId")]
    user_id: String,
    #[serde(default, rename = "roleKeys")]
    role_keys: Vec<String>,
}

/// Index grants by user id. A user with no grant keeps an empty role list —
/// most humans only ever hold roles on projects they were explicitly added
/// to, so "no roles" is a normal answer, not an error.
fn roles_by_user(grants: Vec<ZitadelUserGrant>) -> std::collections::HashMap<String, Vec<String>> {
    let mut map = std::collections::HashMap::new();
    for grant in grants {
        if grant.user_id.is_empty() {
            continue;
        }
        map.entry(grant.user_id)
            .or_insert_with(Vec::new)
            .extend(grant.role_keys.into_iter().filter(|key| !key.is_empty()));
    }
    map
}

/// Machine users (service accounts) have no `human` profile and are filtered
/// out — they aren't people who can be assigned an order stage.
fn assignable_user(user: ZitadelUser, roles: &[String]) -> Option<User> {
    let human = user.human?;
    let display_name = human
        .profile
        .as_ref()
        .and_then(|profile| profile.display_name.clone());
    let name = display_name
        .filter(|name| !name.is_empty())
        .unwrap_or(user.username);
    let email = human
        .email
        .and_then(|email| email.email)
        .filter(|email| !email.is_empty());
    let avatar_url = human
        .profile
        .and_then(|profile| profile.avatar_url)
        .filter(|url| !url.is_empty());

    Some(User {
        id: user.user_id,
        name,
        email,
        avatar_url,
        roles: roles.to_vec(),
        groups: Vec::new(),
    })
}

impl ZitadelUserDirectory {
    pub async fn discover(config: &Config) -> Result<Self, String> {
        let client_id = config
            .zitadel_users_client_id
            .clone()
            .ok_or_else(|| "ZITADEL_USERS_CLIENT_ID is not set".to_string())?;
        let client_secret = config
            .zitadel_users_client_secret
            .clone()
            .ok_or_else(|| "ZITADEL_USERS_CLIENT_SECRET is not set".to_string())?;

        let token_url = format!("{}/oauth/v2/token", config.oauth_issuer_url);

        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("failed to build Zitadel HTTP client: {error}"))?;

        Ok(Self {
            client_id,
            client_secret,
            token_url,
            api_base: config.oauth_issuer_url.clone(),
            http_client,
        })
    }

    async fn exchange_client_credentials(&self) -> Result<String, AppError> {
        let credentials = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", self.client_id, self.client_secret));

        let response = self
            .http_client
            .post(&self.token_url)
            .header("Authorization", format!("Basic {credentials}"))
            .form(&[
                ("grant_type", "client_credentials"),
                ("scope", "openid urn:zitadel:iam:org:project:id:zitadel:aud"),
            ])
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| AppError::Zitadel(format!("Zitadel token request failed: {error}")))?;

        let token_response: TokenResponse = response.json().await.map_err(|error| {
            AppError::Zitadel(format!("failed to parse Zitadel token response: {error}"))
        })?;

        Ok(token_response.access_token)
    }

    pub async fn list_users(&self) -> Result<Vec<User>, AppError> {
        let access_token = self.exchange_client_credentials().await?;

        let mut users = Vec::new();
        let mut offset = 0;
        loop {
            let response = self
                .http_client
                .post(format!("{}/v2/users", self.api_base))
                .bearer_auth(&access_token)
                .json(&SearchUsersRequest {
                    query: SearchQuery {
                        limit: 200,
                        offset,
                        asc: true,
                    },
                    // In Zitadel v4, UNSPECIFIED sorts by the unique user ID.
                    sorting_column: "USER_FIELD_NAME_UNSPECIFIED",
                })
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|error| {
                    AppError::Zitadel(format!("Zitadel users request failed: {error}"))
                })?
                .json::<SearchUsersResponse>()
                .await
                .map_err(|error| {
                    AppError::Zitadel(format!("failed to parse Zitadel users response: {error}"))
                })?;
            let next_offset = response
                .details
                .next_offset(offset, response.result.len())?;
            users.extend(response.result);
            match next_offset {
                Some(next) => offset = next,
                None => break,
            }
        }

        // Role enrichment is best-effort: it needs grant-read permission the
        // machine user may not have, and the directory listing is still
        // useful without it — so a failure here warns and yields empty role
        // lists rather than failing the whole call.
        let roles = match self.user_roles(&access_token).await {
            Ok(roles) => roles,
            Err(error) => {
                tracing::warn!(error = ?error, "Zitadel role enrichment failed; returning users without roles");
                std::collections::HashMap::new()
            }
        };

        Ok(users
            .into_iter()
            .filter_map(|user| {
                let empty = Vec::new();
                let user_roles = roles.get(&user.user_id).unwrap_or(&empty);
                assignable_user(user, user_roles)
            })
            .collect())
    }

    /// Fetch every project role grant visible to the machine user and index
    /// the role keys by user id (`POST
    /// /management/v1/users/grants/_search`), in pages for the whole directory.
    async fn user_roles(
        &self,
        access_token: &str,
    ) -> Result<std::collections::HashMap<String, Vec<String>>, AppError> {
        let mut grants = Vec::new();
        let mut offset = 0;
        loop {
            let response = self
                .http_client
                .post(format!(
                    "{}/management/v1/users/grants/_search",
                    self.api_base
                ))
                .bearer_auth(access_token)
                .json(
                    &serde_json::json!({ "query": SearchQuery { limit: 1000, offset, asc: true } }),
                )
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|error| {
                    AppError::Zitadel(format!("Zitadel grants request failed: {error}"))
                })?
                .json::<SearchGrantsResponse>()
                .await
                .map_err(|error| {
                    AppError::Zitadel(format!("failed to parse Zitadel grants response: {error}"))
                })?;
            let next_offset = response
                .details
                .next_offset(offset, response.result.len())?;
            grants.extend(response.result);
            match next_offset {
                Some(next) => offset = next,
                None => break,
            }
        }

        Ok(roles_by_user(grants))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_display_name_over_username() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "ahmed.alsayed",
            "human": {
                "profile": { "displayName": "Ahmed Al-Sayed" },
                "email": { "email": "ahmed@example.com" }
            }
        }))
        .unwrap();

        let result = assignable_user(user, &[]).unwrap();
        assert_eq!(result.id, "123");
        assert_eq!(result.name, "Ahmed Al-Sayed");
        assert_eq!(result.email.as_deref(), Some("ahmed@example.com"));
        assert!(result.avatar_url.is_none());
        assert!(result.roles.is_empty());
        assert!(result.groups.is_empty());
    }

    #[test]
    fn falls_back_to_username_when_display_name_missing() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "ahmed.alsayed",
            "human": { "profile": {} }
        }))
        .unwrap();

        let result = assignable_user(user, &[]).unwrap();
        assert_eq!(result.name, "ahmed.alsayed");
        assert!(result.email.is_none());
    }

    #[test]
    fn excludes_machine_users() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "service-account",
            "human": null
        }))
        .unwrap();

        assert!(assignable_user(user, &[]).is_none());
    }

    #[test]
    fn passes_through_avatar_and_roles() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "ahmed.alsayed",
            "human": {
                "profile": {
                    "displayName": "Ahmed Al-Sayed",
                    "avatarUrl": "https://zitadel.example/avatar/123"
                },
                "email": { "email": "ahmed@example.com" }
            }
        }))
        .unwrap();

        let roles = vec!["tailor".to_string(), "cutter".to_string()];
        let result = assignable_user(user, &roles).unwrap();
        assert_eq!(
            result.avatar_url.as_deref(),
            Some("https://zitadel.example/avatar/123")
        );
        assert_eq!(result.roles, roles);
    }

    #[test]
    fn grants_index_role_keys_by_user() {
        let response: SearchGrantsResponse = serde_json::from_value(serde_json::json!({
            "details": { "totalResult": "3" },
            "result": [
                { "userId": "123", "roleKeys": ["tailor", "cutter"] },
                { "userId": "456", "roleKeys": ["viewer"] },
                { "userId": "", "roleKeys": ["ghost"] },
            ]
        }))
        .unwrap();

        let map = roles_by_user(response.result);
        assert_eq!(map["123"], vec!["tailor", "cutter"]);
        assert_eq!(map["456"], vec!["viewer"]);
        assert!(!map.contains_key(""));
    }

    #[test]
    fn grants_response_tolerates_missing_result() {
        let response: SearchGrantsResponse =
            serde_json::from_value(serde_json::json!({ "details": {} })).unwrap();
        assert!(roles_by_user(response.result).is_empty());
    }

    #[test]
    fn pagination_uses_actual_page_size_until_total_is_reached() {
        for total in [serde_json::json!(5), serde_json::json!("5")] {
            let details: ListDetails =
                serde_json::from_value(serde_json::json!({ "totalResult": total })).unwrap();
            assert_eq!(details.next_offset(0, 2).unwrap(), Some(2));
            assert_eq!(details.next_offset(2, 2).unwrap(), Some(4));
            assert_eq!(details.next_offset(4, 1).unwrap(), None);
            assert!(details.next_offset(2, 0).is_err());
        }
    }

    #[test]
    fn empty_directory_accepts_omitted_result_and_zero_total() {
        let response: SearchUsersResponse =
            serde_json::from_value(serde_json::json!({ "details": {} })).unwrap();
        assert!(response.result.is_empty());
        assert_eq!(response.details.next_offset(0, 0).unwrap(), None);
    }
}
