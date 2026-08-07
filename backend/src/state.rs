use std::sync::Arc;

use crate::auth::TokenIntrospection;
use crate::config::{Config, InvoiceBranding};
use crate::notifications::WhatsAppClient;
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AppState {
    config: Config,
    db: PgPool,
    token_introspection: TokenIntrospection,
    whatsapp_client: Arc<dyn WhatsAppClient>,
}

impl AppState {
    pub fn new(
        config: Config,
        db: PgPool,
        token_introspection: TokenIntrospection,
        whatsapp_client: Arc<dyn WhatsAppClient>,
    ) -> Self {
        Self {
            config,
            db,
            token_introspection,
            whatsapp_client,
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

    pub fn whatsapp_client(&self) -> &dyn WhatsAppClient {
        self.whatsapp_client.as_ref()
    }
}
