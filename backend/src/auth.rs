use std::{collections::HashMap, future::Future, pin::Pin};

use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    middleware::Next,
    response::Response,
};
use oauth2::{
    basic::{BasicErrorResponse, BasicRevocationErrorResponse, BasicTokenResponse, BasicTokenType},
    reqwest, AccessToken, Client, ClientId, ClientSecret, EndpointNotSet, EndpointSet,
    ExtraTokenFields, IntrospectionUrl, StandardRevocableToken, StandardTokenIntrospectionResponse,
    TokenIntrospectionResponse,
};
use openidconnect::{
    core::{
        CoreAuthDisplay, CoreClaimName, CoreClaimType, CoreClientAuthMethod, CoreGrantType,
        CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreJweKeyManagementAlgorithm,
        CoreResponseMode, CoreResponseType, CoreSubjectIdentifierType,
    },
    AdditionalProviderMetadata, IssuerUrl, ProviderMetadata,
};
use serde::{Deserialize, Serialize};

use crate::{config::Config, error::AppError, state::AppState};

type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Zitadel's project-role assertion claim: a map of role key to
/// `{ orgId: orgName }`. The `oauth2` crate's `BasicClient` fixes its
/// introspection response's extra fields to `EmptyExtraTokenFields`, so this
/// claim is otherwise silently dropped by token introspection.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ZitadelExtraFields {
    #[serde(rename = "urn:zitadel:iam:org:project:roles", default)]
    roles: Option<HashMap<String, HashMap<String, String>>>,
}

impl ExtraTokenFields for ZitadelExtraFields {}

type RoleIntrospectionResponse =
    StandardTokenIntrospectionResponse<ZitadelExtraFields, BasicTokenType>;

type IntrospectionClient = Client<
    BasicErrorResponse,
    BasicTokenResponse,
    RoleIntrospectionResponse,
    StandardRevocableToken,
    BasicRevocationErrorResponse,
    EndpointNotSet,
    EndpointNotSet,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
>;

/// The roles this app recognizes, ordered low-to-high so `PartialOrd`/`Ord`
/// give a hierarchy for free: `Admin` satisfies a `Staff`-or-`Viewer` gate,
/// `Staff` satisfies a `Viewer` gate. Values must match the Zitadel project's
/// role keys exactly (case-sensitive).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Viewer,
    Staff,
    Admin,
}

impl Role {
    fn from_key(key: &str) -> Option<Self> {
        match key {
            "viewer" => Some(Self::Viewer),
            "staff" => Some(Self::Staff),
            "admin" => Some(Self::Admin),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Staff => "staff",
            Self::Admin => "admin",
        }
    }
}

type DiscoveryMetadata = ProviderMetadata<
    OAuthDiscoveryMetadata,
    CoreAuthDisplay,
    CoreClientAuthMethod,
    CoreClaimName,
    CoreClaimType,
    CoreGrantType,
    CoreJweContentEncryptionAlgorithm,
    CoreJweKeyManagementAlgorithm,
    CoreJsonWebKey,
    CoreResponseMode,
    CoreResponseType,
    CoreSubjectIdentifierType,
>;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OAuthDiscoveryMetadata {
    introspection_endpoint: Option<IntrospectionUrl>,
}

impl AdditionalProviderMetadata for OAuthDiscoveryMetadata {}

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    subject: Option<String>,
    client_id: Option<String>,
    scopes: Vec<String>,
    roles: Vec<Role>,
}

#[derive(Clone, Debug)]
pub struct TokenIntrospection {
    client: IntrospectionClient,
    expected_audience: Option<String>,
    http_client: reqwest::Client,
}

impl TokenIntrospection {
    pub async fn discover(config: &Config) -> Result<Self, String> {
        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("failed to build OAuth2 HTTP client: {error}"))?;

        let introspection_url = match &config.oauth_introspection_url {
            Some(url) => IntrospectionUrl::new(url.clone())
                .map_err(|error| format!("invalid OAuth2 introspection URL: {error}"))?,
            None => {
                let provider_metadata = DiscoveryMetadata::discover_async(
                    IssuerUrl::new(config.oauth_issuer_url.clone())
                        .map_err(|error| format!("invalid OAuth2 issuer URL: {error}"))?,
                    &http_client,
                )
                .await
                .map_err(|error| format!("failed to discover OAuth2 issuer metadata: {error}"))?;

                provider_metadata
                    .additional_metadata()
                    .introspection_endpoint
                    .clone()
                    .ok_or_else(|| {
                        "issuer metadata does not include introspection_endpoint; set OAUTH_INTROSPECTION_URL".to_string()
                    })?
            }
        };

        let mut client = Client::<
            BasicErrorResponse,
            BasicTokenResponse,
            RoleIntrospectionResponse,
            StandardRevocableToken,
            BasicRevocationErrorResponse,
        >::new(ClientId::new(config.oauth_client_id.clone()));
        if let Some(client_secret) = &config.oauth_client_secret {
            client = client.set_client_secret(ClientSecret::new(client_secret.clone()));
        }

        let client = client.set_introspection_url(introspection_url);

        Ok(Self {
            client,
            expected_audience: config.oauth_resource_audience.clone(),
            http_client,
        })
    }

    pub async fn introspect_bearer_token(&self, token: &str) -> Result<AuthenticatedUser, String> {
        let response = self
            .client
            .introspect(&AccessToken::new(token.to_string()))
            .set_token_type_hint("access_token")
            .request_async(&self.http_client)
            .await
            .map_err(|error| format!("token introspection request failed: {error}"))?;

        if !response.active() {
            return Err("access token is inactive".to_string());
        }

        if let Some(expected_audience) = &self.expected_audience {
            let audiences = response.aud().ok_or_else(|| {
                format!("introspection response is missing audience `{expected_audience}`")
            })?;

            if !audiences
                .iter()
                .any(|audience| audience == expected_audience)
            {
                return Err(format!(
                    "access token audience does not include `{expected_audience}`"
                ));
            }
        }

        let roles = response
            .extra_fields()
            .roles
            .iter()
            .flatten()
            .filter_map(|(key, _)| Role::from_key(key))
            .collect();

        Ok(AuthenticatedUser {
            subject: response.sub().map(ToOwned::to_owned),
            client_id: response.client_id().map(|client_id| (**client_id).clone()),
            scopes: response
                .scopes()
                .into_iter()
                .flatten()
                .map(|scope| scope.as_ref().to_string())
                .collect(),
            roles,
        })
    }
}

impl AuthenticatedUser {
    pub fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }

    pub fn client_id(&self) -> Option<&str> {
        self.client_id.as_deref()
    }

    pub fn scopes(&self) -> &[String] {
        &self.scopes
    }

    pub fn roles(&self) -> &[Role] {
        &self.roles
    }

    /// Whether this user holds `minimum` or a higher role in the hierarchy
    /// (`Admin` > `Staff` > `Viewer`).
    pub fn has_role(&self, minimum: Role) -> bool {
        self.roles.iter().any(|role| *role >= minimum)
    }
}

/// Extracts the bearer token from `request` as an owned string. Synchronous
/// and only ever borrows `request` briefly, so callers can freely hold the
/// returned token across an `.await` without dragging a `&Request` (not
/// `Sync`, so not `Send`) along with it.
fn bearer_token(request: &Request) -> Result<String, AppError> {
    request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))
}

/// Introspects `token` against Zitadel.
async fn introspect(state: &AppState, token: &str) -> Result<AuthenticatedUser, AppError> {
    state
        .token_introspection()
        .introspect_bearer_token(token)
        .await
        .map_err(AppError::Unauthorized)
}

/// Builds a middleware that authenticates the caller and requires at least
/// `minimum` role, inserting the resolved [`AuthenticatedUser`] (roles and
/// all) as a request extension for handlers that want finer-grained checks.
pub fn require_role(
    minimum: Role,
) -> impl Fn(State<AppState>, Request, Next) -> BoxFuture<'static, Result<Response, AppError>>
       + Clone
       + Send
       + Sync
       + 'static {
    move |State(state): State<AppState>, mut request: Request, next: Next| {
        // Extracted before the async block so no `&Request` (see above) ever
        // needs to be held across an `.await`.
        let token = bearer_token(&request);

        Box::pin(async move {
            let user = introspect(&state, &token?).await?;

            if !user.has_role(minimum) {
                return Err(AppError::Forbidden(format!(
                    "requires role `{}` or higher",
                    minimum.as_str()
                )));
            }

            request.extensions_mut().insert(user);

            Ok(next.run(request).await)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_with_roles(roles: &[Role]) -> AuthenticatedUser {
        AuthenticatedUser {
            subject: None,
            client_id: None,
            scopes: Vec::new(),
            roles: roles.to_vec(),
        }
    }

    #[test]
    fn admin_satisfies_lower_roles() {
        let user = user_with_roles(&[Role::Admin]);
        assert!(user.has_role(Role::Admin));
        assert!(user.has_role(Role::Staff));
        assert!(user.has_role(Role::Viewer));
    }

    #[test]
    fn staff_does_not_satisfy_admin() {
        let user = user_with_roles(&[Role::Staff]);
        assert!(user.has_role(Role::Staff));
        assert!(user.has_role(Role::Viewer));
        assert!(!user.has_role(Role::Admin));
    }

    #[test]
    fn no_roles_fails_every_gate() {
        let user = user_with_roles(&[]);
        assert!(!user.has_role(Role::Viewer));
    }

    #[test]
    fn unknown_role_keys_are_ignored() {
        assert_eq!(Role::from_key("owner"), None);
        assert_eq!(Role::from_key("admin"), Some(Role::Admin));
        assert_eq!(Role::from_key("staff"), Some(Role::Staff));
        assert_eq!(Role::from_key("viewer"), Some(Role::Viewer));
    }
}
