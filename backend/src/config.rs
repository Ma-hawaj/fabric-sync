use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub oauth_issuer_url: String,
    pub oauth_client_id: String,
    pub oauth_client_secret: Option<String>,
    pub oauth_introspection_url: Option<String>,
    pub oauth_resource_audience: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3000);
        let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://postgres:postgres@localhost:5432/fabric_sync".to_string()
        });
        let oauth_issuer_url = env::var("OAUTH_ISSUER_URL")
            .or_else(|_| env::var("OIDC_ISSUER_URL"))
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        let oauth_client_id = env::var("OAUTH_CLIENT_ID")
            .or_else(|_| env::var("OIDC_CLIENT_ID"))
            .unwrap_or_else(|_| "client_id".to_string());
        let oauth_client_secret = env::var("OAUTH_CLIENT_SECRET")
            .or_else(|_| env::var("OIDC_CLIENT_SECRET"))
            .ok();
        let oauth_introspection_url = env::var("OAUTH_INTROSPECTION_URL").ok();
        let oauth_resource_audience = env::var("OAUTH_RESOURCE_AUDIENCE").ok();

        Self {
            port,
            database_url,
            oauth_issuer_url,
            oauth_client_id,
            oauth_client_secret,
            oauth_introspection_url,
            oauth_resource_audience,
        }
    }
}
