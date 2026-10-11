use std::{future::Future, pin::Pin};

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

/// Group/role claims Authentik can surface on its tokens. Authentik's default
/// `profile` scope mapping already emits `groups` (the user's group names);
/// the `entitlements` scope mapping emits `roles`/`entitlements` for the
/// provider's application. The `oauth2` crate's `BasicClient` fixes its
/// introspection response's extra fields to `EmptyExtraTokenFields`, so these
/// claims would otherwise be silently dropped by token introspection.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct AuthentikExtraFields {
    #[serde(default)]
    groups: Option<Vec<String>>,
    #[serde(default)]
    roles: Option<Vec<String>>,
    #[serde(default)]
    entitlements: Option<Vec<String>>,
}

impl ExtraTokenFields for AuthentikExtraFields {}

impl AuthentikExtraFields {
    fn role_names(&self) -> impl Iterator<Item = &str> {
        self.groups
            .iter()
            .flatten()
            .chain(self.roles.iter().flatten())
            .chain(self.entitlements.iter().flatten())
            .map(String::as_str)
    }
}

/// The subset of the OIDC userinfo response this app reads: the same
/// group/role claims as above. Fetched only when token introspection itself
/// carries no role information (see `TokenIntrospection::userinfo_roles`).
#[derive(Clone, Debug, Default, Deserialize)]
struct UserInfoClaims {
    #[serde(default)]
    groups: Option<Vec<String>>,
    #[serde(default)]
    roles: Option<Vec<String>>,
    #[serde(default)]
    entitlements: Option<Vec<String>>,
}

impl UserInfoClaims {
    fn role_names(&self) -> impl Iterator<Item = &str> {
        self.groups
            .iter()
            .flatten()
            .chain(self.roles.iter().flatten())
            .chain(self.entitlements.iter().flatten())
            .map(String::as_str)
    }
}

type RoleIntrospectionResponse =
    StandardTokenIntrospectionResponse<AuthentikExtraFields, BasicTokenType>;

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
/// give the hierarchy for free: `Admin` satisfies a `Staff`-or-`Viewer` gate,
/// `Staff` satisfies a `Viewer` gate. Values match Authentik **group** names
/// (case-insensitive — `admin`, `staff`, `viewer`), so no custom Authentik
/// configuration is needed beyond creating those groups and assigning users
/// to them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Viewer,
    Staff,
    Admin,
}

impl Role {
    fn from_key(key: &str) -> Option<Self> {
        match key.to_ascii_lowercase().as_str() {
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

/// Maps Authentik group/role claim values onto recognized roles, dropping
/// anything else (e.g. branch groups like `"Branch A"`). Sorted low-to-high
/// and deduplicated so the result is deterministic.
fn collect_roles<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<Role> {
    let mut roles: Vec<Role> = names.into_iter().filter_map(Role::from_key).collect();
    roles.sort();
    roles.dedup();
    roles
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
    /// Where `userinfo_roles` falls back to when the introspection response
    /// carries no role claims. `None` only when neither `OAUTH_USERINFO_URL`
    /// nor OIDC discovery provided one — in practice discovery always does,
    /// since `userinfo_endpoint` is mandatory in the OIDC discovery document.
    userinfo_url: Option<String>,
    http_client: reqwest::Client,
}

impl TokenIntrospection {
    pub async fn discover(config: &Config) -> Result<Self, String> {
        let http_client = reqwest::ClientBuilder::new()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("failed to build OAuth2 HTTP client: {error}"))?;

        let mut introspection_url = match &config.oauth_introspection_url {
            Some(url) => Some(
                IntrospectionUrl::new(url.clone())
                    .map_err(|error| format!("invalid OAuth2 introspection URL: {error}"))?,
            ),
            None => None,
        };
        let mut userinfo_url = config.oauth_userinfo_url.clone();

        if introspection_url.is_none() || userinfo_url.is_none() {
            let provider_metadata = DiscoveryMetadata::discover_async(
                IssuerUrl::new(config.oauth_issuer_url.clone())
                    .map_err(|error| format!("invalid OAuth2 issuer URL: {error}"))?,
                &http_client,
            )
            .await
            .map_err(|error| format!("failed to discover OAuth2 issuer metadata: {error}"))?;

            if introspection_url.is_none() {
                introspection_url = Some(
                    provider_metadata
                        .additional_metadata()
                        .introspection_endpoint
                        .clone()
                        .ok_or_else(|| {
                            "issuer metadata does not include introspection_endpoint; set OAUTH_INTROSPECTION_URL".to_string()
                        })?,
                );
            }
            if userinfo_url.is_none() {
                userinfo_url = provider_metadata
                    .userinfo_endpoint()
                    .map(|url| url.as_str().to_string());
            }
        }

        let introspection_url = introspection_url.ok_or_else(|| {
            "no OAuth2 introspection URL; set OAUTH_INTROSPECTION_URL".to_string()
        })?;

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
            userinfo_url,
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

        let mut roles = collect_roles(response.extra_fields().role_names());

        // Authentik's introspection response carries the standard RFC 7662
        // fields; group/role claims only arrive here when a custom scope
        // mapping puts them there. The default `profile` scope mapping
        // already emits `groups` on userinfo, so resolve roles from there
        // instead — one extra IdP round trip per request, OIDC-standard, and
        // no custom Authentik configuration needed.
        if roles.is_empty() {
            roles = collect_roles(self.userinfo_roles(token).await?.role_names());
        }

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

    async fn userinfo_roles(&self, token: &str) -> Result<UserInfoClaims, String> {
        let userinfo_url = self
            .userinfo_url
            .as_deref()
            .ok_or_else(|| "no OIDC userinfo URL; set OAUTH_USERINFO_URL".to_string())?;

        self.http_client
            .get(userinfo_url)
            .bearer_auth(token)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| format!("OIDC userinfo request failed: {error}"))?
            .json::<UserInfoClaims>()
            .await
            .map_err(|error| format!("failed to parse OIDC userinfo response: {error}"))
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

    /// Rejects callers below `minimum` with 403 — the handler-level companion
    /// to the [`require_role`] middleware, for routes that need a stricter
    /// gate than their router's baseline (e.g. admin-only writes).
    pub fn require_role(&self, minimum: Role) -> Result<(), AppError> {
        if self.has_role(minimum) {
            Ok(())
        } else {
            Err(AppError::Forbidden(format!(
                "requires role `{}` or higher",
                minimum.as_str()
            )))
        }
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

/// Introspects `token` against Authentik (falling back to OIDC userinfo for
/// role claims — see above).
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
            user.require_role(minimum)?;

            // Attaches to the request-wide span opened by
            // `request_log::log_request`, which is `Span::current()` here
            // since it's the outermost layer — no extension plumbing needed
            // to get identity onto the canonical log line.
            let span = tracing::Span::current();
            if let Some(subject) = user.subject() {
                span.record("user_id", subject);
            }
            if let Some(client_id) = user.client_id() {
                span.record("client_id", client_id);
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
    fn require_role_method_resolves_like_has_role() {
        let admin = user_with_roles(&[Role::Admin]);
        assert!(admin.require_role(Role::Admin).is_ok());
        assert!(admin.require_role(Role::Staff).is_ok());

        let staff = user_with_roles(&[Role::Staff]);
        assert!(staff.require_role(Role::Viewer).is_ok());
        assert!(staff.require_role(Role::Admin).is_err());

        let nobody = user_with_roles(&[]);
        let err = nobody.require_role(Role::Viewer).unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)));
    }

    #[test]
    fn role_keys_match_case_insensitively() {
        assert_eq!(Role::from_key("admin"), Some(Role::Admin));
        assert_eq!(Role::from_key("Admin"), Some(Role::Admin));
        assert_eq!(Role::from_key("STAFF"), Some(Role::Staff));
        assert_eq!(Role::from_key("viewer"), Some(Role::Viewer));
        assert_eq!(Role::from_key("owner"), None);
        assert_eq!(Role::from_key(""), None);
    }

    #[test]
    fn non_role_groups_are_ignored() {
        // Branch groups like "Branch A" ride the same `groups` claim; only
        // the three app roles resolve.
        assert_eq!(collect_roles(["Branch A", "staff"]), vec![Role::Staff]);
        assert!(collect_roles(["Branch A"]).is_empty());
    }

    #[test]
    fn duplicate_roles_deduplicate() {
        assert_eq!(
            collect_roles(["staff", "Staff", "STAFF", "admin"]),
            vec![Role::Staff, Role::Admin]
        );
    }

    #[test]
    fn introspection_extra_fields_deserialize() {
        let extra: AuthentikExtraFields = serde_json::from_value(serde_json::json!({
            "groups": ["Branch A", "staff"],
        }))
        .unwrap();
        assert_eq!(collect_roles(extra.role_names()), vec![Role::Staff]);
    }

    #[test]
    fn userinfo_claims_deserialize() {
        let claims: UserInfoClaims = serde_json::from_value(serde_json::json!({
            "sub": "123",
            "name": "Ahmed",
            "groups": ["admin"],
            "roles": ["staff"],
            "entitlements": ["viewer"],
        }))
        .unwrap();
        assert_eq!(
            collect_roles(claims.role_names()),
            vec![Role::Viewer, Role::Staff, Role::Admin]
        );
    }

    #[test]
    fn missing_claims_mean_no_roles() {
        let extra: AuthentikExtraFields = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(collect_roles(extra.role_names()).is_empty());

        let claims: UserInfoClaims = serde_json::from_value(serde_json::json!({
            "sub": "123",
        }))
        .unwrap();
        assert!(collect_roles(claims.role_names()).is_empty());
    }
}
