use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{Campaign, CampaignRecipient};

pub struct OptedInCustomer {
    pub id: Uuid,
    pub mobile_no: String,
}

// The server-side re-check that every id the client selected is still
// opted in at send time — a client can't message someone who opted out
// after the compose page loaded.
pub async fn opted_in_customers(
    state: &AppState,
    customer_ids: &[Uuid],
) -> Result<Vec<OptedInCustomer>, sqlx::Error> {
    sqlx::query_as!(
        OptedInCustomer,
        r#"
        SELECT id, mobile_no
        FROM customers
        WHERE id = ANY($1) AND marketing_opt_in
        "#,
        customer_ids,
    )
    .fetch_all(state.db())
    .await
}

pub async fn insert_campaign(
    tx: &mut sqlx::PgTransaction<'_>,
    template_name: &str,
    body: &str,
    created_by: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO notification_campaigns (kind, channel, template_name, body, created_by)
        VALUES ('marketing', 'whatsapp', $1, $2, $3)
        RETURNING id
        "#,
        template_name,
        body,
        created_by,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn insert_recipient(
    tx: &mut sqlx::PgTransaction<'_>,
    campaign_id: Uuid,
    customer_id: Uuid,
    mobile_no: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO notification_recipients (campaign_id, customer_id, mobile_no)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        campaign_id,
        customer_id,
        mobile_no,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn mark_sent(
    tx: &mut sqlx::PgTransaction<'_>,
    recipient_id: Uuid,
    provider_message_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE notification_recipients
        SET status = 'sent', provider_message_id = $2, sent_at = now()
        WHERE id = $1
        "#,
        recipient_id,
        provider_message_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn mark_failed(
    tx: &mut sqlx::PgTransaction<'_>,
    recipient_id: Uuid,
    error_message: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE notification_recipients
        SET status = 'failed', error_message = $2
        WHERE id = $1
        "#,
        recipient_id,
        error_message,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// Shared by list_campaigns (None) and get_campaign (Some(id)) — same
// narrow-by-optional-id shape as customers::repository::fetch_customers.
async fn fetch_campaigns(
    state: &AppState,
    campaign_id: Option<Uuid>,
) -> Result<Vec<Campaign>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            c.id,
            c.body,
            c.template_name,
            c.created_by,
            c.created_at,
            COALESCE(
                json_agg(jsonb_build_object(
                    'id', r.id,
                    'customerId', r.customer_id,
                    'customerName', cu.name,
                    'mobileNo', r.mobile_no,
                    'status', r.status,
                    'errorMessage', r.error_message,
                    'sentAt', r.sent_at
                ) ORDER BY cu.name)
                    FILTER (WHERE r.id IS NOT NULL),
                '[]'
            ) AS "recipients!: Json<Vec<CampaignRecipient>>"
        FROM notification_campaigns c
        LEFT JOIN notification_recipients r ON r.campaign_id = c.id
        LEFT JOIN customers cu ON cu.id = r.customer_id
        WHERE $1::uuid IS NULL OR c.id = $1
        GROUP BY c.id, c.body, c.template_name, c.created_by, c.created_at
        ORDER BY c.created_at DESC
        "#,
        campaign_id,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| Campaign {
            id: row.id,
            body: row.body,
            template_name: row.template_name,
            created_by: row.created_by,
            created_at: row.created_at,
            recipients: row.recipients.0,
        })
        .collect())
}

pub async fn list_campaigns(state: &AppState) -> Result<Vec<Campaign>, sqlx::Error> {
    fetch_campaigns(state, None).await
}

pub async fn get_campaign(
    state: &AppState,
    campaign_id: Uuid,
) -> Result<Option<Campaign>, sqlx::Error> {
    Ok(fetch_campaigns(state, Some(campaign_id)).await?.pop())
}
