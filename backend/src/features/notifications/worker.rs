use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;
use subtle::ConstantTimeEq;

use super::{
    repository::{self, Job},
    service,
};
use crate::{error::AppError, state::AppState};

#[derive(Debug)]
struct Failure {
    message: String,
    retry: bool,
    uncertain: bool,
    retry_after: i64,
}

pub fn start(state: AppState) {
    tokio::spawn(async move {
        let mut maintenance = tokio::time::Instant::now();
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
        loop {
            interval.tick().await;
            if tokio::time::Instant::now() >= maintenance {
                if let Err(error) = repository::cleanup(state.db(), state.notifications()).await {
                    tracing::warn!(error=?error, "notification cleanup failed");
                }
                maintenance = tokio::time::Instant::now() + std::time::Duration::from_secs(3600);
            }
            if let Err(error) = tick(&state).await {
                tracing::error!(error=?error,"notification worker failed");
            }
        }
    });
}

pub(super) async fn tick(state: &AppState) -> Result<(), AppError> {
    // A dead worker may have submitted externally without persisting the ID.
    // Never replay an expired submission lease automatically.
    repository::recover_leases(state.db()).await?;
    process_webhooks(state.db()).await?;
    repository::cancel_blocked(state.db()).await?;
    if !state.notifications().can_send() {
        return Ok(());
    }
    // Read a candidate first, then acquire the invoice before notification and
    // recipient locks, matching readiness and approval transactions.
    let candidate = repository::next_job(state.db()).await?;
    let Some((id, invoice_id)) = candidate else {
        return Ok(());
    };
    let mut tx = state.db().begin().await?;
    repository::lock_invoice(&mut tx, invoice_id).await?;
    let job = repository::lock_job(&mut tx, id).await?;
    let Some(mut job) = job else {
        return Ok(());
    };
    job.attempt_count += 1;
    repository::start_attempt(&mut tx, &job).await?;
    tx.commit().await?;
    let notification = repository::get(state.db(), job.notification_id).await?;
    match service::source(state, notification.invoice_id, &notification.kind).await {
        Ok(source) if source.snapshot.source_hash == notification.source_hash => {}
        Ok(_) | Err(AppError::Conflict(_)) => {
            let mut tx = state.db().begin().await?;
            repository::lock_invoice(&mut tx, notification.invoice_id).await?;
            repository::lock_notification(&mut tx, notification.id).await?;
            repository::mark_stale(&mut tx, notification.id).await?;
            tx.commit().await?;
            finish(
                state,
                &job,
                "cancelled",
                None,
                Some("Invoice or recipients changed. Prepare and approve a fresh preview."),
                false,
                0,
            )
            .await?;
            return Ok(());
        }
        Err(error) => {
            tracing::warn!(notification_id=%notification.id,error=?error,"notification preflight failed");
            finish(
                state,
                &job,
                "failed",
                None,
                Some("Could not revalidate the invoice before sending."),
                true,
                0,
            )
            .await?;
            return Ok(());
        }
    }
    // The claim is the cancellation cutoff. Only frozen data is used from here.
    let result = send(state, &job, &notification).await;
    match result {
        Ok(message_id) => {
            finish(state, &job, "accepted", Some(&message_id), None, false, 0).await?
        }
        Err(error) => {
            finish(
                state,
                &job,
                if error.uncertain {
                    "uncertain"
                } else {
                    "failed"
                },
                None,
                Some(&error.message),
                error.retry,
                error.retry_after,
            )
            .await?
        }
    }
    process_webhooks(state.db()).await?;
    repository::cancel_blocked(state.db()).await?;
    Ok(())
}

async fn finish(
    state: &AppState,
    job: &Job,
    status: &str,
    message_id: Option<&str>,
    error: Option<&str>,
    retry: bool,
    retry_after: i64,
) -> Result<(), AppError> {
    let retry = retry && job.attempt_count < state.notifications().max_attempts;
    let next = if retry { "queued" } else { status };
    let delay = (30_i64 * 2_i64.pow(job.attempt_count.min(5) as u32)).max(retry_after);
    let mut tx = state.db().begin().await?;
    repository::finish_attempt(
        &mut tx,
        job,
        next,
        if retry { "retry_scheduled" } else { status },
        message_id,
        error,
        delay,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn send(
    state: &AppState,
    job: &Job,
    notification: &super::types::NotificationRow,
) -> Result<String, Failure> {
    let config = state.notifications();
    let message = notification
        .snapshot
        .messages
        .get(job.message_index as usize)
        .ok_or_else(|| failure("The approved message sequence is invalid", false, false))?;
    let client = service::http_client()
        .map_err(|_| failure("Could not initialize the sender", true, false))?;
    let token = config
        .access_token
        .as_deref()
        .ok_or_else(|| failure("WhatsApp is not configured", false, false))?;
    let root = format!(
        "https://graph.facebook.com/{}/{}",
        config.api_version,
        config.phone_number_id.as_deref().unwrap_or_default()
    );
    #[cfg(test)]
    let root = config.test_graph_url.clone().unwrap_or(root);
    let mut components = vec![
        json!({"type":"body","parameters":message.parameters.iter().map(|value|json!({"type":"text","text":value})).collect::<Vec<_>>()}),
    ];
    if message.parameters.is_empty() {
        components.clear();
    }
    if message.attach_invoice {
        let artifact_id = notification
            .artifact_id
            .ok_or_else(|| failure("The approved PDF is missing", false, false))?;
        let artifact = repository::artifact_content(state.db(), artifact_id)
            .await
            .map_err(|_| failure("The approved attachment could not be loaded", true, false))?;
        let part = reqwest::multipart::Part::bytes(artifact.1)
            .file_name(artifact.0.clone())
            .mime_str("application/pdf")
            .map_err(|_| failure("Invalid document type", false, false))?;
        let response = client
            .post(format!("{root}/media"))
            .bearer_auth(token)
            .multipart(
                reqwest::multipart::Form::new()
                    .part("file", part)
                    .text("messaging_product", "whatsapp")
                    .text("type", "application/pdf"),
            )
            .send()
            .await
            .map_err(|_| failure("The document upload was interrupted", true, false))?;
        let value = graph_response(response, false).await?;
        let media_id = value["id"]
            .as_str()
            .ok_or_else(|| failure("WhatsApp did not return a media ID", true, false))?;
        components.insert(0,json!({"type":"header","parameters":[{"type":"document","document":{"id":media_id,"filename":artifact.0}}]}));
    }
    repository::request_started(state.db(), job)
        .await
        .map_err(|_| failure("Could not record the send attempt", true, false))?;
    let mut template = json!({"name":message.template_name,"language":{"code":message.language}});
    if !components.is_empty() {
        template["components"] = json!(components);
    }
    let response=client.post(format!("{root}/messages")).bearer_auth(token).json(&json!({"messaging_product":"whatsapp","to":job.normalized_mobile.trim_start_matches('+'),"type":"template","template":template}))
        .send().await.map_err(|_|failure("The send result is unknown. Check WhatsApp delivery before explicitly resending.",false,true))?;
    let value = graph_response(response, true).await?;
    value["messages"][0]["id"]
        .as_str()
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            failure(
                "WhatsApp returned no message ID. Check delivery before resending.",
                false,
                true,
            )
        })
}

fn failure(message: &str, retry: bool, uncertain: bool) -> Failure {
    Failure {
        message: message.chars().take(700).collect(),
        retry,
        uncertain,
        retry_after: 0,
    }
}

async fn graph_response(
    response: reqwest::Response,
    message_request: bool,
) -> Result<Value, Failure> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.parse::<i64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(v)
                    .ok()
                    .map(|at| (at.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_seconds())
            })
        })
        .unwrap_or(0)
        .clamp(0, 86400);
    let value: Value = response.json().await.map_err(|_| {
        failure(
            "WhatsApp returned an unreadable response",
            !message_request,
            message_request,
        )
    })?;
    if status.is_success() {
        return Ok(value);
    }
    let message = value["error"]["message"]
        .as_str()
        .unwrap_or("WhatsApp rejected this request");
    let known_error = value.get("error").is_some();
    let mut error = failure(
        message,
        known_error && (status.as_u16() == 429 || status.is_server_error()),
        message_request && !known_error,
    );
    error.retry_after = retry_after;
    Err(error)
}

pub fn valid_verification_token(expected: Option<&str>, candidate: &str) -> bool {
    expected.is_some_and(|token| bool::from(token.as_bytes().ct_eq(candidate.as_bytes())))
}

pub fn valid_signature(secret: &str, body: &[u8], signature: &str) -> bool {
    let Some(hex) = signature.strip_prefix("sha256=") else {
        return false;
    };
    let Ok(bytes) = hex::decode(hex) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&bytes).is_ok()
}

pub(crate) fn next_status(current: &str, incoming: &str) -> Option<&'static str> {
    match incoming {
        "read" => Some("read"),
        "delivered" if current != "read" => Some("delivered"),
        "sent" if !["read", "delivered", "failed"].contains(&current) => Some("accepted"),
        "failed" if !["read", "delivered"].contains(&current) => Some("failed"),
        _ => None,
    }
}

pub async fn receive_webhook(db: &PgPool, body: &[u8]) -> Result<(), AppError> {
    let payload: Value = serde_json::from_slice(body)
        .map_err(|_| AppError::BadRequest("Invalid webhook JSON.".into()))?;
    repository::store_webhook(db, &service::hash(body), payload).await?;
    process_webhooks(db).await
}

async fn process_webhooks(db: &PgPool) -> Result<(), AppError> {
    let events = repository::pending_webhooks(db).await?;
    for (id, sqlx::types::Json(payload)) in events {
        let mut matched = true;
        for entry in payload["entry"].as_array().into_iter().flatten() {
            for change in entry["changes"].as_array().into_iter().flatten() {
                for status in change["value"]["statuses"].as_array().into_iter().flatten() {
                    let (Some(message_id), Some(incoming)) =
                        (status["id"].as_str(), status["status"].as_str())
                    else {
                        continue;
                    };
                    let mut tx = db.begin().await?;
                    let existing = repository::lock_provider_delivery(&mut tx, message_id).await?;
                    if let Some((delivery, current)) = existing {
                        if let Some(next) = next_status(&current, incoming) {
                            let error = if next == "failed" {
                                Some(status["errors"].to_string())
                            } else {
                                None
                            };
                            repository::delivery_status(&mut tx, delivery, next, error.as_deref())
                                .await?;
                        }
                    } else {
                        matched = false;
                    }
                    tx.commit().await?;
                }
            }
        }
        repository::webhook_checked(db, id, matched).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn webhook_challenge_requires_the_exact_configured_token() {
        assert!(valid_verification_token(Some("test-token"), "test-token"));
        for candidate in [
            "",
            "test-toke",
            "test-token-extra",
            "Test-token",
            "test-Token",
            "test-tokeN",
        ] {
            assert!(!valid_verification_token(Some("test-token"), candidate));
        }
        assert!(!valid_verification_token(None, "test-token"));
        assert!(!valid_verification_token(None, ""));
    }

    #[test]
    fn late_statuses_never_downgrade_confirmed_delivery() {
        assert_eq!(next_status("read", "sent"), None);
        assert_eq!(next_status("delivered", "failed"), None);
        assert_eq!(next_status("failed", "sent"), None);
        assert_eq!(next_status("failed", "delivered"), Some("delivered"));
    }
    #[test]
    fn signatures_bind_the_exact_raw_body() {
        let mut mac = Hmac::<Sha256>::new_from_slice(b"test-secret").unwrap();
        mac.update(b"{\"entry\":[]}");
        let signature = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
        assert!(valid_signature(
            "test-secret",
            b"{\"entry\":[]}",
            &signature
        ));
        assert!(!valid_signature("test-secret", b"{}", &signature));
        assert!(!valid_signature(
            "wrong-secret",
            b"{\"entry\":[]}",
            &signature
        ));
    }
}
