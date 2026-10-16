use crate::auth::TokenIntrospection;
use crate::config::{Config, InvoiceBranding};
use crate::features::users::authentik::AuthentikUserDirectory;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
    db: PgPool,
    token_introspection: TokenIntrospection,
    authentik_users: AuthentikUserDirectory,
}

impl AppState {
    pub fn new(
        config: Config,
        db: PgPool,
        token_introspection: TokenIntrospection,
        authentik_users: AuthentikUserDirectory,
    ) -> Self {
        Self {
            config,
            db,
            token_introspection,
            authentik_users,
        }
    }

    pub fn port(&self) -> u16 {
        self.config.port
    }

    pub fn static_dir(&self) -> &str {
        &self.config.static_dir
    }

    pub fn token_introspection(&self) -> &TokenIntrospection {
        &self.token_introspection
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    pub fn invoice_branding(&self) -> &InvoiceBranding {
        &self.config.invoice_branding
    }

    /// The zone printed documents write dates in, validated at boot.
    pub fn timezone(&self) -> Result<chrono_tz::Tz, crate::error::AppError> {
        self.config
            .timezone()
            .map_err(crate::error::AppError::Config)
    }

    pub fn authentik_users(&self) -> &AuthentikUserDirectory {
        &self.authentik_users
    }
}
