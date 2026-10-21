mod handlers;
pub(crate) mod messages;
mod phone;
pub(crate) mod repository;
mod routes;
pub(crate) mod service;
pub(crate) mod types;
mod worker;

pub use routes::{router, webhook_router};
pub use worker::start;

#[derive(Clone, Debug)]
pub struct Config {
    #[cfg(test)]
    pub test_graph_url: Option<String>,
    pub enabled: bool,
    pub renderer_url: Option<String>,
    pub renderer_profile: String,
    pub phone_number_id: Option<String>,
    pub access_token: Option<String>,
    pub api_version: String,
    pub app_secret: Option<String>,
    pub verification_token: Option<String>,
    pub default_region: String,
    pub language: String,
    pub invoice_template: String,
    pub ready_template: String,
    pub invoice_body: String,
    pub ready_body: String,
    pub invoice_messages: Option<String>,
    pub ready_messages: Option<String>,
    pub max_attempts: i32,
    pub draft_retention_days: i32,
    pub artifact_retention_days: i32,
    pub webhook_retention_days: i32,
}

impl Config {
    pub fn from_env() -> Self {
        fn value(key: &str, fallback: &str) -> String {
            std::env::var(key)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| fallback.into())
        }
        fn optional(key: &str) -> Option<String> {
            std::env::var(key).ok().filter(|v| !v.trim().is_empty())
        }
        Self {
            #[cfg(test)]
            test_graph_url: None,
            enabled: value("WHATSAPP_DELIVERY_ENABLED", "false") == "true",
            renderer_url: optional("DOCUMENT_RENDERER_URL"),
            renderer_profile: value(
                "DOCUMENT_RENDERER_PROFILE",
                "gotenberg-8.38.0-noto-sans-arabic",
            ),
            phone_number_id: optional("WHATSAPP_PHONE_NUMBER_ID"),
            access_token: optional("WHATSAPP_ACCESS_TOKEN"),
            api_version: value("WHATSAPP_API_VERSION", "v23.0"),
            app_secret: optional("WHATSAPP_APP_SECRET"),
            verification_token: optional("WHATSAPP_VERIFY_TOKEN"),
            default_region: value("WHATSAPP_DEFAULT_REGION", "BH"),
            language: value("WHATSAPP_TEMPLATE_LANGUAGE", "en_US"),
            invoice_template: value("WHATSAPP_INVOICE_TEMPLATE", "invoice_document_v1"),
            ready_template: value("WHATSAPP_READY_TEMPLATE", "invoice_ready_v1"),
            invoice_body: value(
                "WHATSAPP_INVOICE_BODY",
                "Your invoice {{1}} from {{2}} is attached. Total: {{3}}. Balance due: {{4}}.",
            ),
            ready_body: value(
                "WHATSAPP_READY_BODY",
                "Your order for invoice {{1}} is ready for pickup at {{2}}. Balance due: {{3}}.",
            ),
            invoice_messages: optional("WHATSAPP_INVOICE_MESSAGES"),
            ready_messages: optional("WHATSAPP_READY_MESSAGES"),
            max_attempts: value("NOTIFICATION_MAX_ATTEMPTS", "5")
                .parse::<i32>()
                .unwrap_or(5)
                .clamp(1, 10),
            draft_retention_days: value("NOTIFICATION_DRAFT_RETENTION_DAYS", "1")
                .parse::<i32>()
                .unwrap_or(1)
                .max(1),
            artifact_retention_days: value("DOCUMENT_ORPHAN_RETENTION_DAYS", "1")
                .parse::<i32>()
                .unwrap_or(1)
                .max(1),
            webhook_retention_days: value("WHATSAPP_WEBHOOK_RETENTION_DAYS", "90")
                .parse::<i32>()
                .unwrap_or(90)
                .max(1),
        }
    }
    pub fn can_send(&self) -> bool {
        self.enabled && self.phone_number_id.is_some() && self.access_token.is_some()
    }
}

#[cfg(test)]
mod tests;
