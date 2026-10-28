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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct ZitadelClaims {
    #[serde(flatten)]
    claims: std::collections::HashMap<String, serde_json::Value>,
}
impl ExtraTokenFields for ZitadelClaims {}
type RoleIntrospectionResponse = StandardTokenIntrospectionResponse<ZitadelClaims, BasicTokenType>;
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
    roles: Vec<crate::authorization::Role>,
}

#[derive(Clone, Debug)]
pub struct TokenIntrospection {
    client: IntrospectionClient,
    expected_audience: Option<String>,
    project_id: String,
    organization_id: String,
    http_client: reqwest::Client,
}

impl TokenIntrospection {
    pub async fn discover(config: &Config) -> Result<Self, String> {
        let project_id = config
            .zitadel_project_id
            .clone()
            .ok_or("ZITADEL_PROJECT_ID is required for role authorization")?;
        let organization_id = config
            .zitadel_organization_id
            .clone()
            .ok_or("ZITADEL_ORGANIZATION_ID is required for role authorization")?;
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
            project_id,
            organization_id,
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

        if !response
            .aud()
            .is_some_and(|audiences| audiences.iter().any(|aud| aud == &self.project_id))
        {
            return Err(
                "access token audience does not include the configured Zitadel project".into(),
            );
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

        let roles = crate::authorization::roles_from_claims(
            &response.extra_fields().claims,
            &self.project_id,
            &self.organization_id,
        );
        Ok(AuthenticatedUser {
            roles,
            subject: response.sub().map(ToOwned::to_owned),
            client_id: response.client_id().map(|client_id| (**client_id).clone()),
            scopes: response
                .scopes()
                .into_iter()
                .flatten()
                .map(|scope| scope.as_ref().to_string())
                .collect(),
        })
    }
}

impl AuthenticatedUser {
    pub fn roles(&self) -> &[crate::authorization::Role] {
        &self.roles
    }
    pub fn has_any_role(&self, roles: &[crate::authorization::Role]) -> bool {
        crate::authorization::has_any_role(&self.roles, roles)
    }

    pub fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }

    pub fn client_id(&self) -> Option<&str> {
        self.client_id.as_deref()
    }

    pub fn scopes(&self) -> &[String] {
        &self.scopes
    }
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".to_string()))?;

    let user = state
        .token_introspection()
        .introspect_bearer_token(token)
        .await
        .map_err(AppError::Unauthorized)?;

    // Attaches to the request-wide span opened by `request_log::log_request`,
    // which is `Span::current()` here since it's the outermost layer — no
    // extension plumbing needed to get identity onto the canonical log line.
    let span = tracing::Span::current();
    if let Some(subject) = user.subject() {
        span.record("user_id", subject);
    }
    if let Some(client_id) = user.client_id() {
        span.record("client_id", client_id);
    }

    let path = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|path| path.as_str())
        .unwrap_or("");
    crate::authorization::authorize(user.roles(), request.method().as_str(), path)?;
    request.extensions_mut().insert(user);

    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        routing::{get, post},
        Json, Router,
    };
    use serde_json::json;

    // Exercise the real OAuth response decoder, matched nested path, and auth
    // middleware together. No database or real identity provider is contacted.
    #[tokio::test]
    async fn introspection_and_route_authorization() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let provider = Router::new().route("/introspect", post(|axum::Form(form): axum::Form<std::collections::HashMap<String, String>>| async move {
            let token = form.get("token").map(String::as_str).unwrap_or("");
            let audience = if token == "wrong-project" { "other" } else { "app" };
            let organization = if token == "wrong-org" { "other" } else { "org" };
            let role = match token { "production" => "production", "no-role" => "unknown", _ => "sales" };
            Json(json!({"active": token != "inactive", "sub": "person", "aud": [audience],
                "urn:zitadel:iam:org:project:app:roles": {role: {organization: "domain"}}
            }))
        }));
        let provider_task =
            tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
        let mut config = Config::from_env();
        config.oauth_introspection_url = Some(format!("http://{address}/introspect"));
        config.oauth_resource_audience = None;
        config.zitadel_project_id = Some("app".into());
        config.zitadel_organization_id = Some("org".into());
        config.zitadel_users_client_id = Some("test".into());
        config.zitadel_users_client_secret = Some("test".into());
        let introspection = TokenIntrospection::discover(&config).await.unwrap();
        let users = crate::features::users::zitadel::ZitadelUserDirectory::discover(&config)
            .await
            .unwrap();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://test:test@127.0.0.1:1/test")
            .unwrap();
        let state = AppState::new(config, pool, introspection, users);
        let api = Router::new()
            .route(
                "/invoices",
                get(|| async { "allowed" }).post(|| async { "saved" }),
            )
            .route_layer(axum::middleware::from_fn_with_state(
                state.clone(),
                require_auth,
            ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let app_address = listener.local_addr().unwrap();
        let app_task = tokio::spawn(async move {
            axum::serve(listener, Router::new().nest("/api", api))
                .await
                .unwrap()
        });
        let client = reqwest::Client::new();
        for (token, expected) in [
            ("sales", 200),
            ("production", 403),
            ("wrong-project", 401),
            ("wrong-org", 403),
            ("inactive", 401),
        ] {
            let response = client
                .get(format!("http://{app_address}/api/invoices"))
                .bearer_auth(token)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), expected, "{token}");
        }
        let response = client
            .get(format!("http://{app_address}/api/invoices"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 401);
        let response = client
            .post(format!("http://{app_address}/api/invoices"))
            .bearer_auth("sales")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 200);
        // Verify auth is installed on every actual feature route, before
        // payload extraction or any database work can take place.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let actual_address = listener.local_addr().unwrap();
        let actual_app = crate::app::router(state);
        let actual_task =
            tokio::spawn(async move { axum::serve(listener, actual_app).await.unwrap() });
        let rules: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../../frontend/src/lib/access-policy.json"))
                .unwrap();
        for rule in rules {
            let path = rule["path"].as_str().unwrap();
            if path == "/me/preferences" {
                continue;
            }
            let path = path
                .split('/')
                .map(|part| {
                    if part.starts_with(':') {
                        "00000000-0000-0000-0000-000000000001"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join("/");
            let method = rule["method"].as_str().unwrap();
            let response = client
                .request(
                    reqwest::Method::from_bytes(method.as_bytes()).unwrap(),
                    format!("http://{actual_address}/api{path}"),
                )
                .bearer_auth("no-role")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), 403, "{method} {path}");
        }
        let health = client
            .get(format!("http://{actual_address}/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(health.status().as_u16(), 200);
        actual_task.abort();
        provider_task.abort();
        app_task.abort();
    }
}
