use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool};

use super::auto_reply::{Incoming, Job, Settings, Update};
use crate::error::AppError;

pub async fn settings(db: &PgPool) -> Result<Settings, AppError> {
    Ok(sqlx::query_as(
        "SELECT enabled, message, cooldown_hours, max_per_minute, button FROM whatsapp_auto_reply_settings",
    )
    .fetch_one(db)
    .await?)
}

// The singleton lock serializes settings changes, enqueueing, and claims across
// all workers. No in-memory cooldowns or process-local rate limits are used.
async fn lock_settings(conn: &mut PgConnection) -> Result<Settings, AppError> {
    Ok(sqlx::query_as("SELECT enabled, message, cooldown_hours, max_per_minute, button FROM whatsapp_auto_reply_settings FOR UPDATE")
        .fetch_one(conn).await?)
}

pub async fn update(db: &PgPool, input: &Update, actor: &str) -> Result<Settings, AppError> {
    let mut tx = db.begin().await?;
    lock_settings(&mut tx).await?;
    sqlx::query("UPDATE whatsapp_auto_reply_settings SET enabled=$1, message=$2, cooldown_hours=$3, max_per_minute=$4, updated_by=$5, button=$6")
        .bind(input.enabled).bind(&input.message).bind(input.cooldown_hours)
        .bind(input.max_per_minute).bind(actor).bind(input.button.as_ref().map(sqlx::types::Json)).execute(&mut *tx).await?;
    if !input.enabled {
        sqlx::query("UPDATE whatsapp_auto_replies SET status='cancelled' WHERE status='queued'")
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    settings(db).await
}

async fn cooling_down(
    conn: &mut PgConnection,
    phone: &str,
    customer: &str,
    hours: i32,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM whatsapp_auto_reply_contacts WHERE phone_number_id=$1 AND customer_key=$2 AND last_attempt_at > clock_timestamp()-make_interval(hours=>$3))")
        .bind(phone).bind(customer).bind(hours).fetch_one(conn).await?)
}

pub async fn enqueue(db: &PgPool, incoming: &Incoming, can_send: bool) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let settings = lock_settings(&mut tx).await?;
    // Remember suppressed messages too: enabling later must never replay them.
    let inserted = sqlx::query("INSERT INTO whatsapp_auto_replies(inbound_message_id,phone_number_id,customer_key,destination,destination_field,received_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
        .bind(&incoming.id).bind(&incoming.phone_number_id).bind(&incoming.customer_key)
        .bind(&incoming.destination).bind(incoming.destination_field).bind(incoming.received_at)
        .execute(&mut *tx).await?.rows_affected() == 1;
    if inserted && settings.enabled && can_send {
        let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM whatsapp_auto_replies WHERE phone_number_id=$1 AND customer_key=$2 AND status IN ('queued','submitting'))")
            .bind(&incoming.phone_number_id).bind(&incoming.customer_key).fetch_one(&mut *tx).await?;
        if !pending
            && !cooling_down(
                &mut tx,
                &incoming.phone_number_id,
                &incoming.customer_key,
                settings.cooldown_hours,
            )
            .await?
        {
            sqlx::query(
                "UPDATE whatsapp_auto_replies SET status='queued' WHERE inbound_message_id=$1",
            )
            .bind(&incoming.id)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

pub async fn claim(
    db: &PgPool,
    phone: Option<&str>,
    can_send: bool,
) -> Result<Option<Job>, AppError> {
    let mut tx = db.begin().await?;
    let settings = lock_settings(&mut tx).await?;
    // An interrupted submission may already have reached Meta. Never replay it.
    sqlx::query("UPDATE whatsapp_auto_replies SET status='uncertain', error_message='Worker stopped during submission; automatic retry disabled.' WHERE status='submitting' AND attempted_at < clock_timestamp()-interval '3 minutes'")
        .execute(&mut *tx).await?;
    // Leave an hour of margin inside Meta's 24-hour customer-service window.
    sqlx::query("UPDATE whatsapp_auto_replies SET status='cancelled' WHERE status='queued' AND (received_at < clock_timestamp()-interval '23 hours' OR phone_number_id IS DISTINCT FROM $1 OR NOT $2)")
        .bind(phone).bind(settings.enabled && can_send).execute(&mut *tx).await?;
    if !settings.enabled || !can_send {
        tx.commit().await?;
        return Ok(None);
    }
    let recent: i64 = sqlx::query_scalar("SELECT count(*) FROM whatsapp_auto_replies WHERE attempted_at > clock_timestamp()-interval '1 minute'")
        .fetch_one(&mut *tx).await?;
    if recent >= i64::from(settings.max_per_minute) {
        tx.commit().await?;
        return Ok(None);
    }
    let candidate: Option<(String, String, String, String, String, DateTime<Utc>)> = sqlx::query_as("SELECT inbound_message_id,phone_number_id,customer_key,destination,destination_field,received_at FROM whatsapp_auto_replies WHERE status='queued' ORDER BY created_at,inbound_message_id LIMIT 1 FOR UPDATE")
        .fetch_optional(&mut *tx).await?;
    let Some((id, phone, customer, destination, destination_field, _)) = candidate else {
        tx.commit().await?;
        return Ok(None);
    };
    if cooling_down(&mut tx, &phone, &customer, settings.cooldown_hours).await? {
        sqlx::query(
            "UPDATE whatsapp_auto_replies SET status='suppressed' WHERE inbound_message_id=$1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(None);
    }
    sqlx::query("UPDATE whatsapp_auto_replies SET status='submitting', attempted_at=clock_timestamp() WHERE inbound_message_id=$1")
        .bind(&id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO whatsapp_auto_reply_contacts(phone_number_id,customer_key,last_attempt_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(phone_number_id,customer_key) DO UPDATE SET last_attempt_at=EXCLUDED.last_attempt_at")
        .bind(phone).bind(customer).execute(&mut *tx).await?;
    // Committing the claim is the on/off cutoff. The approved settings are
    // frozen for this one in-flight request; disabling cancels every queued one.
    tx.commit().await?;
    Ok(Some(Job {
        id,
        destination,
        destination_field,
        message: settings.message,
        button: settings.button.map(|button| button.0),
    }))
}

pub async fn finish(
    db: &PgPool,
    id: &str,
    status: &str,
    message_id: Option<&str>,
    error: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE whatsapp_auto_replies SET status=$2, provider_message_id=$3, error_message=$4 WHERE inbound_message_id=$1 AND status='submitting'")
        .bind(id).bind(status).bind(message_id).bind(error).execute(db).await?;
    Ok(())
}

pub async fn known_message(conn: &mut PgConnection, id: &str) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM whatsapp_auto_replies WHERE provider_message_id=$1)",
    )
    .bind(id)
    .fetch_one(conn)
    .await?)
}

pub async fn cleanup(conn: &mut PgConnection, retention_days: i32) -> Result<(), AppError> {
    sqlx::query("DELETE FROM whatsapp_auto_replies WHERE created_at < clock_timestamp()-make_interval(days=>$1) AND status NOT IN ('queued','submitting')")
        .bind(retention_days.max(8)).execute(&mut *conn).await?;
    sqlx::query("DELETE FROM whatsapp_auto_reply_contacts WHERE last_attempt_at < clock_timestamp()-interval '8 days'")
        .execute(conn).await?;
    Ok(())
}
