use super::types::*;
use crate::error::AppError;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

pub async fn customers(db: &PgPool, invoice_id: Uuid) -> Result<Vec<Customer>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT DISTINCT c.id,
               c.name,
               c.mobile_no,
               c.whatsapp_notifications_enabled AS enabled
          FROM customers c
         WHERE c.id = (
                SELECT customer_id
                  FROM invoices
                 WHERE id = $1
               )
            OR EXISTS(
                SELECT 1
                  FROM orders o
                  JOIN measurements m
                    ON m.id = o.measurement_id
                 WHERE o.invoice_id = $1
                   AND m.customer_id = c.id
               )
         ORDER BY c.id
        "#,
    )
    .bind(invoice_id)
    .fetch_all(db)
    .await?)
}

pub async fn get(db: &PgPool, id: Uuid) -> Result<NotificationRow, AppError> {
    sqlx::query_as(
        r#"
        SELECT id,
               invoice_id,
               kind,
               state,
               source_hash,
               preview_version,
               snapshot,
               artifact_id,
               created_at
          FROM notifications
         WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Notification not found.".into()))
}

pub async fn recipients(db: &PgPool, id: Uuid) -> Result<Vec<Recipient>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id,
               normalized_mobile,
               customers,
               selected,
               status,
               error_message,
               sent_at
          FROM notification_recipients
         WHERE notification_id = $1
         ORDER BY normalized_mobile
        "#,
    )
    .bind(id)
    .fetch_all(db)
    .await?)
}

pub async fn history(db: &PgPool, invoice_id: Uuid) -> Result<Vec<History>, AppError> {
    Ok(sqlx::query_as(
        r#"
        WITH recent AS (
            SELECT id FROM notifications
             WHERE invoice_id = $1 AND approved_at IS NOT NULL
             ORDER BY approved_at DESC, id DESC
             LIMIT 100
        ), latest AS (
            SELECT DISTINCT ON (kind = 'invoice_ready') id FROM notifications
             WHERE invoice_id = $1 AND approved_at IS NOT NULL
             ORDER BY (kind = 'invoice_ready'), approved_at DESC, id DESC
        )
        SELECT n.id,
               n.kind,
               n.state,
               n.approved_at AS created_at,
               count(r.id) FILTER (WHERE r.selected) AS recipient_count,
               count(r.id) FILTER (WHERE r.status IN ('queued','submitting')) AS queued_count,
               count(r.id) FILTER (WHERE r.status = 'accepted') AS accepted_count,
               count(r.id) FILTER (WHERE r.status IN ('delivered','read')) AS delivered_count,
               count(r.id) FILTER (WHERE r.status = 'failed') AS failed_count,
               count(r.id) FILTER (WHERE r.status = 'uncertain') AS uncertain_count,
               count(r.id) FILTER (WHERE r.selected AND r.status = 'cancelled') AS cancelled_count
          FROM notifications n
          LEFT JOIN notification_recipients r
            ON r.notification_id = n.id
         WHERE n.invoice_id = $1
           AND n.approved_at IS NOT NULL
           AND n.id IN (SELECT id FROM recent UNION SELECT id FROM latest)
         GROUP BY n.id
         ORDER BY n.approved_at DESC, n.id DESC
        "#,
    )
    .bind(invoice_id)
    .fetch_all(db)
    .await?)
}

pub async fn revision(db: &PgPool, invoice_id: Uuid) -> Result<(i64, i64), AppError> {
    sqlx::query_as(
        r#"
        SELECT notification_revision,
               readiness_generation
          FROM invoices
         WHERE id = $1
        "#,
    )
    .bind(invoice_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invoice not found.".into()))
}

pub async fn artifact_id(db: &PgPool, invoice: Uuid, hash: &str) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM document_artifacts WHERE invoice_id=$1 AND source_hash=$2",
    )
    .bind(invoice)
    .bind(hash)
    .fetch_optional(db)
    .await?)
}

pub async fn store_artifact(
    db: &PgPool,
    invoice: Uuid,
    source_hash: &str,
    filename: &str,
    content_hash: &str,
    bytes: &[u8],
) -> Result<Uuid, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        INSERT INTO document_artifacts(invoice_id,source_hash,filename,sha256,byte_length,content)
        VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(invoice_id,source_hash) DO UPDATE
           SET source_hash = EXCLUDED.source_hash RETURNING id
        "#,
    )
    .bind(invoice)
    .bind(source_hash)
    .bind(filename)
    .bind(content_hash)
    .bind(bytes.len() as i64)
    .bind(bytes)
    .fetch_one(db)
    .await?)
}

pub async fn artifact_content(db: &PgPool, id: Uuid) -> Result<(String, Vec<u8>), AppError> {
    sqlx::query_as(
        r#"
        SELECT filename,
               content
          FROM document_artifacts
         WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Document not found.".into()))
}

pub async fn artifact_metadata(db: &PgPool, id: Uuid) -> Result<DocumentMetadata, AppError> {
    sqlx::query_as(
        r#"
        SELECT id,
               invoice_id,
               filename,
               mime_type,
               sha256,
               byte_length,
               created_at
          FROM document_artifacts
         WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound("Document not found.".into()))
}

pub async fn event(
    db: &PgPool,
    invoice: Uuid,
    key: &str,
) -> Result<Option<NotificationRow>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id,
               invoice_id,
               kind,
               state,
               source_hash,
               preview_version,
               snapshot,
               artifact_id,
               created_at
          FROM notifications
         WHERE invoice_id = $1
           AND event_key = $2
           AND state IN ('draft','approved')
        "#,
    )
    .bind(invoice)
    .bind(key)
    .fetch_optional(db)
    .await?)
}

pub async fn lock_invoice(conn: &mut PgConnection, id: Uuid) -> Result<i64, AppError> {
    sqlx::query_scalar(
        r#"
        SELECT notification_revision
          FROM invoices
         WHERE id = $1
           FOR UPDATE
        "#,
    )
    .bind(id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(|| AppError::NotFound("Invoice not found.".into()))
}

pub async fn belongs_to_invoice(
    conn: &mut PgConnection,
    id: Uuid,
    invoice: Uuid,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM notifications WHERE id=$1 AND invoice_id=$2 AND approved_at IS NOT NULL)",
    )
    .bind(id)
    .bind(invoice)
    .fetch_one(conn)
    .await?)
}

pub async fn lock_event(
    conn: &mut PgConnection,
    invoice: Uuid,
    key: &str,
) -> Result<Option<(Uuid, String)>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id,
               source_hash
          FROM notifications
         WHERE invoice_id = $1
           AND event_key = $2
           AND state IN ('draft','approved')
           FOR UPDATE
        "#,
    )
    .bind(invoice)
    .bind(key)
    .fetch_optional(conn)
    .await?)
}

pub async fn approved_event(
    conn: &mut PgConnection,
    invoice: Uuid,
    key: &str,
) -> Result<Option<NotificationRow>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id,
               invoice_id,
               kind,
               state,
               source_hash,
               preview_version,
               snapshot,
               artifact_id,
               created_at
          FROM notifications
         WHERE invoice_id = $1
           AND event_key = $2
           AND approved_at IS NOT NULL
        "#,
    )
    .bind(invoice)
    .bind(key)
    .fetch_optional(conn)
    .await?)
}

pub async fn lock_notification(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<(String, Uuid), AppError> {
    sqlx::query_as(
        r#"
        SELECT state,
               preview_version
          FROM notifications
         WHERE id = $1
           FOR UPDATE
        "#,
    )
    .bind(id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(|| {
        AppError::Conflict("This preview was closed or expired. Prepare it again.".into())
    })
}

pub async fn mark_stale(conn: &mut PgConnection, id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE notifications SET state='stale' WHERE id=$1 AND state IN ('draft','approved')",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    cancel_unstarted(conn, id).await
}

pub async fn insert_notification(
    conn: &mut PgConnection,
    invoice: Uuid,
    input: &PrepareInput,
    key: &str,
    snapshot: &Snapshot,
    artifact: Option<Uuid>,
    actor: &str,
) -> Result<Uuid, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,snapshot,artifact_id,created_by,resend_of)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
        "#
    )
        .bind(invoice)
        .bind(&input.kind)
        .bind(key)
        .bind(&snapshot.source_hash)
        .bind(Uuid::new_v4())
        .bind(sqlx::types::Json(snapshot))
        .bind(artifact)
        .bind(actor)
        .bind(input.resend_of)
        .fetch_one(conn).await?)
}

pub async fn insert_recipient(
    conn: &mut PgConnection,
    id: Uuid,
    recipient: &Destination,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO notification_recipients(notification_id,normalized_mobile,customers)
        VALUES($1,$2,$3)
        "#,
    )
    .bind(id)
    .bind(&recipient.mobile)
    .bind(sqlx::types::Json(&recipient.customers))
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn mobiles(
    conn: &mut PgConnection,
    id: Uuid,
    selected_only: bool,
) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT normalized_mobile
          FROM notification_recipients
         WHERE notification_id = $1
           AND (NOT $2 OR selected)
        "#,
    )
    .bind(id)
    .bind(selected_only)
    .fetch_all(conn)
    .await?)
}

pub async fn select_recipients(
    conn: &mut PgConnection,
    id: Uuid,
    selected: &[String],
    queue: bool,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET selected = normalized_mobile = ANY($2),
               status = CASE WHEN $3 AND normalized_mobile = ANY($2) THEN 'queued'
                    ELSE 'draft'
                     END
         WHERE notification_id = $1
        "#,
    )
    .bind(id)
    .bind(selected)
    .bind(queue)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn approve(conn: &mut PgConnection, id: Uuid, actor: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE notifications SET state='approved',approved_by=$2,approved_at=now() WHERE id=$1",
    )
    .bind(id)
    .bind(actor)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn refresh_version(conn: &mut PgConnection, id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notifications
           SET preview_version = $2
         WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(Uuid::new_v4())
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn has_started(conn: &mut PgConnection, id: Uuid) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT EXISTS(
                SELECT 1
                  FROM notification_recipients
                 WHERE notification_id = $1
                   AND status IN ('submitting','accepted','delivered','read','uncertain')
               )
        "#,
    )
    .bind(id)
    .fetch_one(conn)
    .await?)
}

pub async fn cancel_unstarted(conn: &mut PgConnection, id: Uuid) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET status = 'cancelled',
               updated_at = now()
         WHERE notification_id = $1
           AND status IN ('draft','queued')
        "#,
    )
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn cancel(conn: &mut PgConnection, id: Uuid) -> Result<(), AppError> {
    cancel_unstarted(conn, id).await?;
    sqlx::query(
        r#"
        UPDATE notifications
           SET state = 'cancelled'
         WHERE id = $1
        "#,
    )
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn preview_invoice(db: &PgPool, id: Uuid) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT invoice_id FROM notifications WHERE id=$1 AND approved_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db)
    .await?)
}

pub async fn delete_preview(conn: &mut PgConnection, id: Uuid) -> Result<(), AppError> {
    // Approval is permanent, even if a queued send is later cancelled or stale.
    // The recipient cascade removes only draft selections; attempts retain their FK guard.
    sqlx::query("DELETE FROM notifications WHERE id=$1 AND approved_at IS NULL")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct Job {
    pub id: Uuid,
    pub notification_id: Uuid,
    pub normalized_mobile: String,
    pub attempt_count: i32,
}

pub async fn recover_leases(db: &PgPool) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET status = 'uncertain',
               error_message = 'The sender stopped before the result was recorded. Check delivery before explicitly resending.',
               updated_at = now()
         WHERE status = 'submitting'
           AND claimed_at < now() - interval '3 minutes'
        "#
    )
        .execute(db).await?;
    Ok(())
}

pub async fn next_job(db: &PgPool) -> Result<Option<(Uuid, Uuid)>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT r.id,
               n.invoice_id
          FROM notification_recipients r
          JOIN notifications n
            ON n.id = r.notification_id
         WHERE r.status = 'queued'
           AND n.state = 'approved'
           AND r.next_attempt_at <= now()
         ORDER BY r.next_attempt_at,
                  r.id
         LIMIT 1
        "#,
    )
    .fetch_optional(db)
    .await?)
}

pub async fn lock_job(conn: &mut PgConnection, id: Uuid) -> Result<Option<Job>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT r.id,
               r.notification_id,
               r.normalized_mobile,
               r.attempt_count
          FROM notification_recipients r
          JOIN notifications n
            ON n.id = r.notification_id
         WHERE r.id = $1
           AND r.status = 'queued'
           AND n.state = 'approved'
           AND r.next_attempt_at <= now()
           FOR UPDATE OF n,
               r SKIP LOCKED
        "#,
    )
    .bind(id)
    .fetch_optional(conn)
    .await?)
}

pub async fn start_attempt(conn: &mut PgConnection, job: &Job) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET status = 'submitting',
               claimed_at = now(),
               attempt_count = $2,
               updated_at = now()
         WHERE id = $1
        "#,
    )
    .bind(job.id)
    .bind(job.attempt_count)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO notification_attempts(recipient_id,attempt_number,outcome)
        VALUES($1,$2,'preparing')
        "#,
    )
    .bind(job.id)
    .bind(job.attempt_count)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn finish_attempt(
    conn: &mut PgConnection,
    job: &Job,
    next: &str,
    outcome: &str,
    message_id: Option<&str>,
    error: Option<&str>,
    delay: i64,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET status = $2,
               provider_message_id = COALESCE($3,provider_message_id),
               error_message = $4,
               next_attempt_at = now() + make_interval(secs => $5::float8),
               sent_at = CASE WHEN $2 = 'accepted' THEN now()
                    ELSE sent_at
                     END,
               updated_at = now()
         WHERE id = $1
           AND status = 'submitting'
        "#,
    )
    .bind(job.id)
    .bind(next)
    .bind(message_id)
    .bind(error)
    .bind(delay as f64)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        r#"
        UPDATE notification_attempts
           SET finished_at = now(),
               outcome = $3,
               provider_message_id = $4,
               error_message = $5
         WHERE recipient_id = $1
           AND attempt_number = $2
        "#,
    )
    .bind(job.id)
    .bind(job.attempt_count)
    .bind(outcome)
    .bind(message_id)
    .bind(error)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn request_started(db: &PgPool, job: &Job) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_attempts
           SET outcome = 'request_started'
         WHERE recipient_id = $1
           AND attempt_number = $2
        "#,
    )
    .bind(job.id)
    .bind(job.attempt_count)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn store_webhook(
    db: &PgPool,
    hash: &str,
    payload: serde_json::Value,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO whatsapp_webhook_events(event_hash,payload)
        VALUES($1,$2)
            ON
        CONFLICT DO NOTHING
        "#,
    )
    .bind(hash)
    .bind(sqlx::types::Json(payload))
    .execute(db)
    .await?;
    Ok(())
}

pub async fn pending_webhooks(
    db: &PgPool,
) -> Result<Vec<(i64, sqlx::types::Json<serde_json::Value>)>, AppError> {
    Ok(sqlx::query_as(
        r#"
        SELECT id,
               payload
          FROM whatsapp_webhook_events
         WHERE NOT processed
         ORDER BY last_checked_at NULLS FIRST,
                  id
         LIMIT 50
        "#,
    )
    .fetch_all(db)
    .await?)
}

pub async fn lock_provider_recipient(
    conn: &mut PgConnection,
    message: &str,
) -> Result<Option<(Uuid, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT id,status FROM notification_recipients WHERE provider_message_id=$1 FOR UPDATE",
    )
    .bind(message)
    .fetch_optional(conn)
    .await?)
}

pub async fn delivery_status(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    error: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        UPDATE notification_recipients
           SET status = $2,
               error_message = $3,
               updated_at = now()
         WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(status)
    .bind(error)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn webhook_checked(db: &PgPool, id: i64, matched: bool) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE whatsapp_webhook_events SET processed=$2,last_checked_at=now() WHERE id=$1",
    )
    .bind(id)
    .bind(matched)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn cleanup(db: &PgPool, config: &super::Config) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    sqlx::query(
        r#"
        DELETE FROM notifications
         WHERE approved_at IS NULL
           AND (state IN ('stale', 'cancelled')
                OR created_at < now() - make_interval(days => $1))
        "#,
    )
    .bind(config.draft_retention_days)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        DELETE
          FROM document_artifacts a
         WHERE created_at < now() - make_interval(days => $1)
           AND NOT EXISTS(
                SELECT 1
                  FROM notifications n
                 WHERE n.artifact_id = a.id
               )
        "#,
    )
    .bind(config.artifact_retention_days)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM whatsapp_webhook_events WHERE created_at < now()-make_interval(days=>$1)",
    )
    .bind(config.webhook_retention_days)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
