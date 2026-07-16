use axum::{
    extract::{Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::Next,
    response::Response,
};
use oauth2::{
    basic::BasicClient, reqwest, AccessToken, ClientId, ClientSecret, EndpointNotSet, EndpointSet,
    IntrospectionUrl, TokenIntrospectionResponse,
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

use crate::{config::Config, state::AppState};

type IntrospectionClient = BasicClient<EndpointNotSet, EndpointNotSet, EndpointSet>;
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

        let mut client = BasicClient::new(ClientId::new(config.oauth_client_id.clone()));
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

        Ok(AuthenticatedUser {
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
) -> Result<Response, StatusCode> {
    let token = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let user = state
        .token_introspection()
        .introspect_bearer_token(token)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    request.extensions_mut().insert(user);

    Ok(next.run(request).await)
}
