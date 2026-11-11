use super::{provider, repository as store, types::Preview};
use crate::{error::AppError, state::AppState};
use chrono::Utc;
use std::time::Duration;

pub fn start(state: AppState) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        let mut sync_at = tokio::time::Instant::now();
        let mut maintenance_at = tokio::time::Instant::now();
        loop {
            timer.tick().await;
            if state.notifications().waba_id.is_some()
                && state.notifications().access_token.is_some()
                && tokio::time::Instant::now() >= sync_at
            {
                if let Err(error) = provider::sync(&state).await {
                    tracing::warn!(error=?error,"marketing template sync failed");
                }
                sync_at = tokio::time::Instant::now() + Duration::from_secs(300);
            }
            if tokio::time::Instant::now() >= maintenance_at {
                if let Err(error) = store::maintenance(state.db()).await {
                    tracing::error!(error=?error,"campaign maintenance failed");
                }
                maintenance_at = tokio::time::Instant::now() + Duration::from_secs(5);
            }
            if let Err(error) = dispatch(&state).await {
                tracing::error!(error=?error,"campaign worker failed");
            }
        }
    });
}
#[cfg(test)]
pub(crate) async fn tick(state: &AppState) -> Result<(), AppError> {
    store::maintenance(state.db()).await?;
    dispatch(state).await
}
async fn dispatch(state: &AppState) -> Result<(), AppError> {
    if !state.notifications().marketing_enabled || !state.notifications().can_send() {
        return Ok(());
    }
    let Some(job) = store::claim(state.db(), state.notifications().campaign_interval_ms).await?
    else {
        return Ok(());
    };
    let c = store::campaign(&mut *state.db().acquire().await?, job.campaign_id, false).await?;
    let p: Preview = serde_json::from_value(
        c.preview
            .ok_or_else(|| AppError::Config("Approved campaign has no snapshot.".into()))?,
    )
    .map_err(|e| AppError::Config(e.to_string()))?;
    // Revalidate with Meta before dispatch. A status outage blocks, never sends.
    match provider::refresh(state, &p.template).await {
        Ok(true) => {}
        result => {
            let reason=match result{Err(_)=>"Could not verify template eligibility with Meta.",_=>"Approved template is paused, archived, or changed. Cancel and prepare a new campaign if its content changed."};
            store::block(state.db(), job.campaign_id, reason).await?;
            store::finish(state.db(), &job, "queued", None, Some(reason), 60).await?;
            return Ok(());
        }
    }
    if Utc::now() >= p.expires_at {
        store::finish(
            state.db(),
            &job,
            "expired",
            None,
            Some("Sending deadline reached."),
            0,
        )
        .await?;
        return Ok(());
    }
    let delivery_attempt = store::begin_delivery(state.db(), &job).await?;
    match provider::send(state, &job, &p).await {
        Ok(id) => store::finish(state.db(), &job, "accepted", Some(&id), None, 0).await?,
        Err(e) => {
            let retry =
                e.retry && !e.uncertain && delivery_attempt < state.notifications().max_attempts;
            let status = if e.message
                == "Campaign cancelled, expired, or consent withdrawn before submission."
            {
                store::dispatch_rejection(state.db(), &job).await?
            } else if e.uncertain {
                "uncertain"
            } else if retry {
                "queued"
            } else {
                "failed"
            };
            let delay = (30_i64 * 2_i64.pow(delivery_attempt.min(5) as u32)).max(e.retry_after);
            store::finish(state.db(), &job, status, None, Some(&e.message), delay).await?;
        }
    }
    Ok(())
}
