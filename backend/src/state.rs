use crate::auth::TokenIntrospection;
use crate::config::Config;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
    db: PgPool,
    token_introspection: TokenIntrospection,
}

impl AppState {
    pub fn new(config: Config, db: PgPool, token_introspection: TokenIntrospection) -> Self {
        Self {
            config,
            db,
            token_introspection,
        }
    }

    pub fn port(&self) -> u16 {
        self.config.port
    }

    pub fn token_introspection(&self) -> &TokenIntrospection {
        &self.token_introspection
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }
}
