use crate::auth::TokenIntrospection;
use crate::config::{Config, InvoiceBranding};
use crate::features::users::zitadel::ZitadelUserDirectory;
use crate::features::whatsapp::service::WhatsAppClient;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
    db: PgPool,
    token_introspection: TokenIntrospection,
    zitadel_users: ZitadelUserDirectory,
    whatsapp: Option<WhatsAppClient>,
}

impl AppState {
    pub fn new(
        config: Config,
        db: PgPool,
        token_introspection: TokenIntrospection,
        zitadel_users: ZitadelUserDirectory,
    ) -> Self {
        Self {
            whatsapp: WhatsAppClient::from_config(&config),
            config,
            db,
            token_introspection,
            zitadel_users,
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

    pub fn invoice_branding(&self) -> &InvoiceBranding {
        &self.config.invoice_branding
    }

    pub fn zitadel_users(&self) -> &ZitadelUserDirectory {
        &self.zitadel_users
    }

    /// `None` when the WhatsApp env vars are unset — the endpoint then rejects
    /// with a clear message instead of the server failing to boot without them.
    pub fn whatsapp(&self) -> Option<&WhatsAppClient> {
        self.whatsapp.as_ref()
    }
}
