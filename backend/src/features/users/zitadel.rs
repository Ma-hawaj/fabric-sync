use oauth2::{
    basic::BasicClient, reqwest, ClientId, ClientSecret, EndpointNotSet, EndpointSet, Scope,
    TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};

use crate::{config::Config, error::AppError};

use super::types::User;

type ClientCredentialsClient =
    BasicClient<EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

/// Backs `list_users` with Zitadel's own v2 Users API — not part of the OIDC
/// standard, so unlike `auth::TokenIntrospection` this is unapologetically
/// Zitadel-specific. Authenticates as a dedicated machine user via the
/// client credentials grant; separate from `oauth_client_id`/`secret`, which
/// authenticate an API resource-server credential that has no grantable
/// directory-read permission of its own. The machine user needs an
/// org-level `ORG_USER_MANAGER` role granted to it in the Zitadel console —
/// there is no way to check that from here, so a missing grant surfaces as
/// a 500 from `list_users` (Zitadel's API returns a permission error).
#[derive(Clone, Debug)]
pub struct ZitadelUserDirectory {
    client: ClientCredentialsClient,
    api_base: String,
    http_client: reqwest::Client,
}

#[derive(Serialize)]
struct SearchUsersRequest {
    query: SearchUsersQuery,
}

#[derive(Serialize)]
struct SearchUsersQuery {
    limit: u32,
}

#[derive(Deserialize)]
struct SearchUsersResponse {
    result: Vec<ZitadelUser>,
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
}

#[derive(Deserialize)]
struct ZitadelProfile {
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

/// Machine users (service accounts) have no `human` profile and are filtered
/// out — they aren't people who can be assigned an order stage.
fn assignable_user(user: ZitadelUser) -> Option<User> {
    let display_name = user.human?.profile.and_then(|profile| profile.display_name);
    let name = display_name
        .filter(|name| !name.is_empty())
        .unwrap_or(user.username);

    Some(User {
        id: user.user_id,
        name,
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

        let token_url = TokenUrl::new(format!("{}/oauth/v2/token", config.oauth_issuer_url))
            .map_err(|error| format!("invalid Zitadel token URL: {error}"))?;

        let client = BasicClient::new(ClientId::new(client_id))
            .set_client_secret(ClientSecret::new(client_secret))
            .set_token_uri(token_url);

        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("failed to build Zitadel HTTP client: {error}"))?;

        Ok(Self {
            client,
            api_base: config.oauth_issuer_url.clone(),
            http_client,
        })
    }

    pub async fn list_users(&self) -> Result<Vec<User>, AppError> {
        let token = self
            .client
            .exchange_client_credentials()
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new(
                "urn:zitadel:iam:org:project:id:zitadel:aud".to_string(),
            ))
            .request_async(&self.http_client)
            .await
            .map_err(|error| {
                AppError::Zitadel(format!(
                    "Zitadel client credentials request failed: {error}"
                ))
            })?;

        let response = self
            .http_client
            .post(format!("{}/v2/users", self.api_base))
            .bearer_auth(token.access_token().secret())
            .json(&SearchUsersRequest {
                query: SearchUsersQuery { limit: 200 },
            })
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| AppError::Zitadel(format!("Zitadel users request failed: {error}")))?
            .json::<SearchUsersResponse>()
            .await
            .map_err(|error| {
                AppError::Zitadel(format!("failed to parse Zitadel users response: {error}"))
            })?;

        Ok(response
            .result
            .into_iter()
            .filter_map(assignable_user)
            .collect())
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
            "human": { "profile": { "displayName": "Ahmed Al-Sayed" } }
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.id, "123");
        assert_eq!(result.name, "Ahmed Al-Sayed");
    }

    #[test]
    fn falls_back_to_username_when_display_name_missing() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "ahmed.alsayed",
            "human": { "profile": {} }
        }))
        .unwrap();

        let result = assignable_user(user).unwrap();
        assert_eq!(result.name, "ahmed.alsayed");
    }

    #[test]
    fn excludes_machine_users() {
        let user: ZitadelUser = serde_json::from_value(serde_json::json!({
            "userId": "123",
            "username": "service-account",
            "human": null
        }))
        .unwrap();

        assert!(assignable_user(user).is_none());
    }
}
