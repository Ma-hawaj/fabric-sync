use super::{
    repository::{self, Job},
    service,
    transport::{self, Failure},
};
use crate::{error::AppError, state::AppState};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;
use sqlx::PgPool;
use subtle::ConstantTimeEq;

pub fn start(state: AppState) {
    tokio::spawn(async move {
        let mut maintenance = tokio::time::Instant::now();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            interval.tick().await;
            if tokio::time::Instant::now() >= maintenance {
                if let Err(error) = repository::cleanup(state.db(), state.notifications()).await {
                    tracing::warn!(error=?error,"notification cleanup failed");
                }
                maintenance = tokio::time::Instant::now() + std::time::Duration::from_secs(3600);
            }
            if let Err(error) = tick(&state).await {
                tracing::error!(error=?error,"notification worker failed");
            }
        }
    });
}
pub(crate) async fn tick(state: &AppState) -> Result<(), AppError> {
    repository::recover_leases(state.db()).await?;
    crate::features::campaigns::repository::maintenance(state.db()).await?;
    process_webhooks(state.db()).await?;
    if !state.notifications().can_send() {
        return Ok(());
    }
    let Some((id, request)) =
        repository::next_job_for_channels(state.db(), state.notifications().marketing_enabled)
            .await?
    else {
        return Ok(());
    };
    let candidate = repository::target(state.db(), request).await?;
    // Provider template checks occur before opening a claim transaction. A
    // paused marketing campaign cannot hold locks or consume critical jobs.
    if let Some(campaign) = candidate.campaign_id {
        if !crate::features::campaigns::service::template_ready(state, campaign, id).await? {
            return Ok(());
        }
    }
    let mut tx = state.db().begin().await?;
    let target = repository::lock_target(&mut tx, request).await?;
    let Some(mut job) = repository::lock_job(&mut tx, id).await? else {
        return Ok(());
    };
    let notification = repository::get_in(&mut tx, job.notification_id).await?;
    let current_request = repository::is_current_request(&mut tx, request).await?;
    if let Some(campaign) = target.campaign_id {
        if let Some(reason) =
            crate::features::campaigns::repository::eligible(&mut tx, campaign, id).await?
        {
            job.attempt_count += 1;
            repository::start_attempt(&mut tx, &job).await?;
            repository::finish_attempt(
                &mut tx,
                &job,
                reason,
                reason,
                None,
                Some("Campaign expired, cancelled, or recipient consent/phone changed."),
                0,
            )
            .await?;
            tx.commit().await?;
            return Ok(());
        }
        if !crate::features::campaigns::repository::reserve(
            &mut tx,
            campaign,
            state.notifications().campaign_interval_ms,
        )
        .await?
        {
            return Ok(());
        }
    }
    let gift_validation = if let Some(card) = target.gift_card_id {
        Some(
            crate::features::gift_cards::delivery::validate(
                state,
                &mut tx,
                card,
                &notification.source_hash,
            )
            .await,
        )
    } else {
        None
    };
    job.attempt_count += 1;
    repository::start_attempt(&mut tx, &job).await?;
    tx.commit().await?;
    let validation = if target.campaign_id.is_some() {
        Ok(true)
    } else if let Some(result) = gift_validation {
        result
    } else {
        service::source(
            state,
            notification.invoice_id()?,
            &notification.kind,
            notification.snapshot.repair_id,
        )
        .await
        .map(|s| s.snapshot.source_hash == notification.source_hash)
    };
    let invalid = match validation {
        Ok(true) if current_request => None,
        Ok(_) | Err(AppError::Conflict(_)) => Some((
            "cancelled",
            "The notification or recipient changed. Prepare and approve a fresh preview."
                .to_string(),
            false,
        )),
        Err(AppError::BadRequest(reason)) | Err(AppError::Unavailable(reason))
            if target.gift_card_id.is_some() =>
        {
            Some(("failed", reason, false))
        }
        Err(error) => {
            tracing::warn!(notification_id=%notification.id,error=?error,"notification preflight failed");
            Some((
                "failed",
                "Could not revalidate the notification before sending.".into(),
                true,
            ))
        }
    };
    if let Some((status, message, retry)) = invalid {
        if status == "cancelled" {
            let mut tx = state.db().begin().await?;
            repository::lock_target(&mut tx, request).await?;
            repository::lock_notification(&mut tx, notification.id).await?;
            repository::mark_stale(&mut tx, notification.id).await?;
            tx.commit().await?;
        }
        finish(state, &job, status, None, Some(&message), retry, 0).await?;
        return Ok(());
    }
    let result = send(state, &job, &notification, request, target.campaign_id).await;
    match result {
        Ok(id) => finish(state, &job, "accepted", Some(&id), None, false, 0).await?,
        Err(error) => {
            let status = if error.uncertain {
                "uncertain"
            } else {
                error.terminal_status.unwrap_or("failed")
            };
            finish(
                state,
                &job,
                status,
                None,
                Some(&error.message),
                error.retry,
                error.retry_after,
            )
            .await?;
        }
    }
    process_webhooks(state.db()).await?;
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
    request: uuid::Uuid,
    campaign: Option<uuid::Uuid>,
) -> Result<String, Failure> {
    let artifact = if let Some(id) = notification.artifact_id {
        Some(repository::attachment(state.db(), id).await.map_err(|_| {
            transport::failure("The approved attachment could not be loaded", true, false)
        })?)
    } else {
        None
    };
    let prepared = transport::prepare(state, &notification.snapshot, artifact).await?;
    let mut tx = state
        .db()
        .begin()
        .await
        .map_err(|_| transport::failure("Could not record the send attempt", true, false))?;
    if let Some(campaign) = campaign {
        repository::lock_target(&mut tx, request)
            .await
            .map_err(|_| transport::failure("Could not lock campaign", true, false))?;
        if let Some(status) =
            crate::features::campaigns::repository::eligible(&mut tx, campaign, job.id)
                .await
                .map_err(|_| transport::failure("Could not revalidate campaign", true, false))?
        {
            let mut error=transport::failure("Campaign expired, cancelled, or recipient consent/phone changed before submission.",false,false);
            error.terminal_status = Some(status);
            return Err(error);
        }
    }
    repository::request_started(&mut tx, job)
        .await
        .map_err(|_| transport::failure("Could not record the send attempt", true, false))?;
    tx.commit()
        .await
        .map_err(|_| transport::failure("Could not record the send attempt", true, false))?;
    transport::submit(state, &job.normalized_mobile, prepared).await
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

fn next_status(current: &str, incoming: &str) -> Option<&'static str> {
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
                    let existing = repository::lock_provider_recipient(&mut tx, message_id).await?;
                    if let Some((recipient, current)) = existing {
                        if let Some(next) = next_status(&current, incoming) {
                            let error = if next == "failed" {
                                Some(status["errors"].to_string())
                            } else {
                                None
                            };
                            repository::delivery_status(&mut tx, recipient, next, error.as_deref())
                                .await?;
                        }
                    } else {
                        matched = false;
                    }
                    tx.commit().await?;
                }
            }
        }
        crate::features::campaigns::service::webhook(db, &payload).await?;
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
