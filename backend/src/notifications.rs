use async_trait::async_trait;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct SendOutcome {
    pub provider_message_id: String,
}

#[derive(Clone, Debug)]
pub struct SendError(pub String);

/// Sends one outbound message over a notification channel. `AppState` holds a
/// `dyn` implementation so callers never depend on a concrete provider —
/// swapping in a real Twilio/Meta client later means implementing this trait
/// and changing the construction in `main.rs`, not reworking any feature
/// built on this seam.
#[async_trait]
pub trait WhatsAppClient: std::fmt::Debug + Send + Sync {
    async fn send_message(&self, to: &str, body: &str) -> Result<SendOutcome, SendError>;
}

/// Logs the send and reports success immediately — no real Twilio/Meta
/// account is wired up yet. Mirrors `features::users::service::list_users`: a
/// deliberately hardcoded stand-in kept behind the same seam the real
/// integration will use.
#[derive(Clone, Debug, Default)]
pub struct StubWhatsAppClient;

#[async_trait]
impl WhatsAppClient for StubWhatsAppClient {
    async fn send_message(&self, to: &str, body: &str) -> Result<SendOutcome, SendError> {
        tracing::info!(to, body, "stub WhatsApp send (no provider configured)");

        Ok(SendOutcome {
            provider_message_id: format!("stub-{}", Uuid::now_v7()),
        })
    }
}
