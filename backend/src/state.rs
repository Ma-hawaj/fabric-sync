use crate::auth::TokenIntrospection;
use crate::config::{Config, InvoiceBranding};
use crate::features::users::zitadel::ZitadelUserDirectory;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
    db: PgPool,
    token_introspection: TokenIntrospection,
    zitadel_users: ZitadelUserDirectory,
}

impl AppState {
    pub fn new(
        config: Config,
        db: PgPool,
        token_introspection: TokenIntrospection,
        zitadel_users: ZitadelUserDirectory,
    ) -> Self {
        Self {
            config,
            db,
            token_introspection,
            zitadel_users,
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

    pub fn notifications(&self) -> &crate::features::notifications::Config {
        &self.config.notifications
    }

    pub fn db(&self) -> &PgPool {
        &self.db
    }

    pub fn urgent_charge_rule(
        &self,
    ) -> Result<Option<crate::features::pricing::types::UrgentChargeRule>, crate::error::AppError>
    {
        self.config
            .urgent_charge_rule()
            .map_err(crate::error::AppError::Config)
    }

    pub fn invoice_branding(&self) -> &InvoiceBranding {
        &self.config.invoice_branding
    }

    pub fn customer_material_base_price(&self) -> Result<Option<f64>, crate::error::AppError> {
        self.config
            .customer_material_base_price()
            .map_err(crate::error::AppError::Config)
    }

    /// The zone printed documents write dates in, validated at boot.
    pub fn timezone(&self) -> Result<chrono_tz::Tz, crate::error::AppError> {
        self.config
            .timezone()
            .map_err(crate::error::AppError::Config)
    }

    pub fn zitadel_users(&self) -> &ZitadelUserDirectory {
        &self.zitadel_users
    }
}
