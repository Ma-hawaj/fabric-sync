use super::types::*;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

// Consent writes, approvals and dispatch claims share one short lock. No HTTP
// request is made while holding it. The submitting claim is the opt-out cutoff.
pub async fn consent_lock(db: &mut PgConnection) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(842101)")
        .execute(db)
        .await?;
    Ok(())
}
pub async fn campaign(db: &mut PgConnection, id: Uuid, lock: bool) -> Result<Campaign, AppError> {
    let sql = format!(
        "SELECT * FROM campaigns WHERE id=$1{}",
        if lock { " FOR UPDATE" } else { "" }
    );
    sqlx::query_as(&sql)
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Campaign not found.".into()))
}
pub async fn campaigns(db: &PgPool, p: &Pagination) -> Result<Value, AppError> {
    let items: Vec<Campaign> = sqlx::query_as(
        "SELECT * FROM campaigns ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2",
    )
    .bind(p.limit())
    .bind(p.offset())
    .fetch_all(db)
    .await?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM campaigns")
        .fetch_one(db)
        .await?;
    Ok(json!({"items":items,"total":total}))
}
pub async fn save_campaign(
    db: &PgPool,
    id: Option<Uuid>,
    input: &CampaignInput,
    actor: &str,
) -> Result<Campaign, AppError> {
    let mut tx = db.begin().await?;
    let definition = json!(input);
    let id = if let Some(id) = id {
        let c = campaign(&mut tx, id, true).await?;
        if c.state != "draft" || Some(c.revision) != input.expected_revision {
            return Err(AppError::Conflict(
                "Only the current draft can be edited.".into(),
            ));
        }
        sqlx::query("UPDATE campaigns SET name=$2,definition=$3,revision=$4,preview=NULL,preview_version=NULL WHERE id=$1").bind(id).bind(&input.name).bind(&definition).bind(Uuid::new_v4()).execute(&mut *tx).await?;
        id
    } else {
        sqlx::query_scalar(
            "INSERT INTO campaigns(name,definition,created_by) VALUES($1,$2,$3) RETURNING id",
        )
        .bind(&input.name)
        .bind(&definition)
        .bind(actor)
        .fetch_one(&mut *tx)
        .await?
    };
    let result = campaign(&mut tx, id, false).await?;
    tx.commit().await?;
    Ok(result)
}
pub async fn save_preview(
    db: &mut PgConnection,
    id: Uuid,
    preview: &Preview,
) -> Result<(), AppError> {
    sqlx::query("UPDATE campaigns SET preview=$2,preview_version=$3 WHERE id=$1")
        .bind(id)
        .bind(json!(preview))
        .bind(preview.version)
        .execute(db)
        .await?;
    Ok(())
}
pub async fn approve(
    db: &mut PgConnection,
    c: &Campaign,
    p: &Preview,
    input: &ApproveInput,
    actor: &str,
) -> Result<(), AppError> {
    for d in &p.destinations {
        sqlx::query("INSERT INTO campaign_recipients(campaign_id,mobile,customers,consent_version) VALUES($1,$2,$3,$4)").bind(c.id).bind(&d.mobile).bind(json!(d.customers)).bind(d.consent_version).execute(&mut *db).await?;
    }
    sqlx::query("UPDATE campaigns SET state='scheduled',approved_by=$2,approved_at=now(),approval_request_id=$3,send_at=COALESCE($4,now()),expires_at=$5 WHERE id=$1").bind(c.id).bind(actor).bind(input.request_id).bind(p.send_at).bind(p.expires_at).execute(db).await?;
    Ok(())
}
pub async fn approval_request(db: &mut PgConnection, id: Uuid) -> Result<Option<Uuid>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM campaigns WHERE approval_request_id=$1")
            .bind(id)
            .fetch_optional(db)
            .await?,
    )
}
pub async fn cancel(db: &PgPool, id: Uuid) -> Result<Campaign, AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    let c = campaign(&mut tx, id, true).await?;
    if !["completed", "expired", "cancelled"].contains(&c.state.as_str()) {
        sqlx::query("UPDATE campaigns SET state='cancelled' WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE campaign_recipients SET state='cancelled',updated_at=now() WHERE campaign_id=$1 AND state='queued'").bind(id).execute(&mut *tx).await?;
    }
    let c = campaign(&mut tx, id, false).await?;
    tx.commit().await?;
    Ok(c)
}
pub async fn template(db: &mut PgConnection, id: Uuid) -> Result<Template, AppError> {
    sqlx::query_as("SELECT * FROM campaign_templates WHERE id=$1")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Marketing template not found.".into()))
}
pub async fn templates(db: &PgPool) -> Result<Vec<Template>, AppError> {
    Ok(
        sqlx::query_as("SELECT * FROM campaign_templates ORDER BY created_at DESC,id DESC")
            .fetch_all(db)
            .await?,
    )
}
pub async fn save_template(
    db: &PgPool,
    id: Option<Uuid>,
    input: &TemplateInput,
    actor: &str,
) -> Result<Template, AppError> {
    let mut tx = db.begin().await?;
    let id = if let Some(id) = id {
        sqlx::query("SELECT id FROM campaign_templates WHERE id=$1 FOR UPDATE")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let t = template(&mut tx, id).await?;
        if t.state != "draft" || Some(t.revision) != input.expected_revision {
            return Err(AppError::Conflict(
                "Submitted templates are immutable. Create a new version with a new name.".into(),
            ));
        }
        sqlx::query("UPDATE campaign_templates SET name=$2,language=$3,definition=$4,revision=$5 WHERE id=$1").bind(id).bind(&input.name).bind(&input.language).bind(json!(input.definition)).bind(Uuid::new_v4()).execute(&mut *tx).await?;
        id
    } else {
        sqlx::query_scalar("INSERT INTO campaign_templates(name,language,definition,created_by) VALUES($1,$2,$3,$4) RETURNING id").bind(&input.name).bind(&input.language).bind(json!(input.definition)).bind(actor).fetch_one(&mut *tx).await?
    };
    let t = template(&mut tx, id).await?;
    tx.commit().await?;
    Ok(t)
}
pub async fn archive_template(db: &PgPool, id: Uuid) -> Result<(), AppError> {
    let result = sqlx::query("UPDATE campaign_templates SET archived=true WHERE id=$1")
        .bind(id)
        .execute(db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Marketing template not found.".into()));
    }
    Ok(())
}
pub async fn begin_submission(db: &PgPool, id: Uuid) -> Result<Template, AppError> {
    let mut tx = db.begin().await?;
    let row:Option<Uuid>=sqlx::query_scalar("UPDATE campaign_templates SET state='submitting' WHERE id=$1 AND state='draft' AND NOT archived RETURNING id").bind(id).fetch_optional(&mut *tx).await?;
    if row.is_none() {
        return Err(AppError::Conflict(
            "Template is already submitted or archived. Synchronize its status.".into(),
        ));
    }
    let t = template(&mut tx, id).await?;
    tx.commit().await?;
    Ok(t)
}
pub async fn submitted(
    db: &PgPool,
    id: Uuid,
    provider_id: Option<&str>,
    state: &str,
    reason: Option<&str>,
    components: &Value,
) -> Result<(), AppError> {
    sqlx::query("UPDATE campaign_templates SET provider_id=COALESCE($2,provider_id),state=$3,rejection_reason=$4,provider_components=$5,synced_at=now() WHERE id=$1").bind(id).bind(provider_id).bind(state).bind(reason).bind(components).execute(db).await?;
    Ok(())
}
pub async fn template_event(
    db: &PgPool,
    provider_id: &str,
    state: &str,
    reason: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE campaign_templates SET state=$2,rejection_reason=$3,synced_at=now() WHERE provider_id=$1").bind(provider_id).bind(state).bind(reason).execute(db).await?;
    Ok(())
}
pub async fn customer_mobile(db: &mut PgConnection, id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT mobile_no FROM customers WHERE id=$1")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Customer not found.".into()))
}
pub async fn consent(db: &mut PgConnection, mobile: &str) -> Result<Option<Consent>, AppError> {
    Ok(
        sqlx::query_as("SELECT * FROM marketing_consent WHERE mobile=$1")
            .bind(mobile)
            .fetch_optional(db)
            .await?,
    )
}

pub async fn consents(db: &mut PgConnection, mobiles: &[String]) -> Result<Vec<Consent>, AppError> {
    Ok(
        sqlx::query_as("SELECT * FROM marketing_consent WHERE mobile = ANY($1)")
            .bind(mobiles)
            .fetch_all(db)
            .await?,
    )
}
pub async fn record_consent(
    db: &mut PgConnection,
    mobile: &str,
    granted: bool,
    observed_at: DateTime<Utc>,
    source: &str,
    actor: &str,
    event: Option<&str>,
) -> Result<(), AppError> {
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO marketing_consent_events(mobile,granted,observed_at,source,recorded_by,provider_event_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_event_id) DO NOTHING RETURNING id").bind(mobile).bind(granted).bind(observed_at).bind(source).bind(actor).bind(event).fetch_optional(&mut *db).await?;
    if inserted.is_none() {
        return Ok(());
    }
    // Old provider events must never undo a later explicit opt-in/withdrawal.
    let changed=sqlx::query("INSERT INTO marketing_consent(mobile,granted,observed_at,source,recorded_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(mobile) DO UPDATE SET granted=$2,observed_at=$3,source=$4,recorded_by=$5,version=$6,updated_at=now() WHERE marketing_consent.observed_at <= $3 OR (NOT $2 AND date_trunc('second',marketing_consent.observed_at)=date_trunc('second',$3::timestamptz))").bind(mobile).bind(granted).bind(observed_at).bind(source).bind(actor).bind(Uuid::new_v4()).execute(&mut *db).await?;
    if !granted && changed.rows_affected() > 0 {
        sqlx::query("UPDATE campaign_recipients SET state='skipped',error_message='Marketing consent withdrawn.',updated_at=now() WHERE mobile=$1 AND state='queued'").bind(mobile).execute(&mut *db).await?;
    }
    Ok(())
}
pub async fn asset(db: &mut PgConnection, id: Uuid) -> Result<(Asset, Vec<u8>), AppError> {
    let meta =
        sqlx::query_as("SELECT id,filename,mime_type,sha256 FROM campaign_assets WHERE id=$1")
            .bind(id)
            .fetch_optional(&mut *db)
            .await?
            .ok_or_else(|| AppError::NotFound("Campaign image not found.".into()))?;
    let bytes = sqlx::query_scalar("SELECT content FROM campaign_assets WHERE id=$1")
        .bind(id)
        .fetch_one(db)
        .await?;
    Ok((meta, bytes))
}
pub async fn insert_asset(
    db: &PgPool,
    input: &AssetInput,
    bytes: &[u8],
    hash: &str,
    actor: &str,
) -> Result<Asset, AppError> {
    Ok(sqlx::query_as("INSERT INTO campaign_assets(filename,mime_type,content,sha256,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,filename,mime_type,sha256").bind(&input.filename).bind(&input.mime_type).bind(bytes).bind(hash).bind(actor).fetch_one(db).await?)
}
pub async fn audience(
    db: &mut PgConnection,
    f: &AudienceFilter,
    timezone: &str,
) -> Result<Vec<AudienceCustomer>, AppError> {
    Ok(sqlx::query_as(r#"
    WITH associated AS (
        SELECT customer_id, id AS invoice_id FROM invoices WHERE customer_id IS NOT NULL
        UNION
        SELECT m.customer_id, o.invoice_id FROM orders o JOIN measurements m ON m.id=o.measurement_id
    ), purchases AS (
        SELECT a.customer_id,i.id,i.invoice_date,i.issuing_branch_id,b.net_total
        FROM associated a JOIN invoices i ON i.id=a.invoice_id JOIN invoice_balances b ON b.invoice_id=i.id
        WHERE b.net_total > 0
    ), totals AS (
        SELECT c.id,c.name,c.mobile_no,count(p.id) AS purchase_count,
            COALESCE(sum(p.net_total),0) AS spend,max(p.invoice_date) AS last_purchase,
            COALESCE(bool_or(p.issuing_branch_id=$8),false) AS branch_match
        FROM customers c LEFT JOIN purchases p ON p.customer_id=c.id GROUP BY c.id
    ) SELECT id,name,mobile_no,purchase_count,spend::text AS lifetime_spend,last_purchase
      FROM totals WHERE (NOT $1 OR purchase_count=0)
      AND ($2::date IS NULL OR (last_purchase AT TIME ZONE $9)::date >= $2)
      AND ($3::date IS NULL OR (last_purchase AT TIME ZONE $9)::date <= $3)
      AND ($4::bigint IS NULL OR purchase_count >= $4)
      AND ($5::bigint IS NULL OR purchase_count <= $5)
      AND ($6::text IS NULL OR spend >= $6::numeric)
      AND ($7::text IS NULL OR spend <= $7::numeric)
      AND ($8::uuid IS NULL OR branch_match)
      ORDER BY id
    "#).bind(f.never_purchased).bind(f.last_purchase_from).bind(f.last_purchase_to).bind(f.min_purchases).bind(f.max_purchases).bind(&f.min_spend).bind(&f.max_spend).bind(f.branch_id).bind(timezone).fetch_all(db).await?)
}
pub async fn recipients(db: &PgPool, id: Uuid, p: &Pagination) -> Result<Value, AppError> {
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r) - 'consent_version' - 'request_started' FROM campaign_recipients r WHERE campaign_id=$1 ORDER BY mobile LIMIT $2 OFFSET $3").bind(id).bind(p.limit()).bind(p.offset()).fetch_all(db).await?;
    let counts:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_object_agg(state,n),'{}') FROM (SELECT state,count(*) AS n FROM campaign_recipients WHERE campaign_id=$1 GROUP BY state) s").bind(id).fetch_one(db).await?;
    let total: i64 =
        sqlx::query_scalar("SELECT count(*) FROM campaign_recipients WHERE campaign_id=$1")
            .bind(id)
            .fetch_one(db)
            .await?;
    let unsubscribes:i64=sqlx::query_scalar("SELECT count(*) FROM campaign_recipients WHERE campaign_id=$1 AND unsubscribed_at IS NOT NULL").bind(id).fetch_one(db).await?;
    Ok(json!({"items":rows,"total":total,"counts":counts,"unsubscribes":unsubscribes}))
}
pub async fn maintenance(db: &PgPool) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    // Only attempts that reached the message boundary become uncertain.
    sqlx::query("UPDATE campaign_recipients SET state=CASE WHEN request_started THEN 'uncertain' ELSE 'queued' END,lease_until=NULL,error_message='Worker lease expired; submission may need reconciliation.',updated_at=now() WHERE state='submitting' AND lease_until < now()").execute(&mut *tx).await?;
    sqlx::query("UPDATE campaign_attempts a SET finished_at=now(),outcome=r.state,error_message=r.error_message FROM campaign_recipients r WHERE a.recipient_id=r.id AND a.attempt_number=r.attempt_count AND a.finished_at IS NULL AND r.state <> 'submitting'").execute(&mut *tx).await?;
    sqlx::query("UPDATE campaign_recipients r SET state='expired',updated_at=now() FROM campaigns c WHERE c.id=r.campaign_id AND c.expires_at <= now() AND r.state='queued'").execute(&mut *tx).await?;
    sqlx::query("UPDATE campaigns c SET state=CASE WHEN expires_at <= now() THEN 'expired' ELSE 'completed' END WHERE state IN ('scheduled','sending','blocked') AND NOT EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.state IN ('queued','submitting'))").execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn claim(db: &PgPool, interval_ms: i64) -> Result<Option<Job>, AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    let clock: bool = sqlx::query_scalar(
        "SELECT next_at <= now() FROM campaign_dispatch_clock WHERE id=true FOR UPDATE",
    )
    .fetch_one(&mut *tx)
    .await?;
    if !clock {
        return Ok(None);
    }
    let job:Option<Job>=sqlx::query_as("SELECT r.id,r.campaign_id,r.mobile,r.attempt_count FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.state='queued' AND r.available_at <= now() AND c.state IN ('scheduled','sending','blocked') AND c.send_at <= now() AND c.expires_at > now() ORDER BY c.send_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1").fetch_optional(&mut *tx).await?;
    let Some(mut job) = job else { return Ok(None) };
    // Phone-scoped consent and source identities are rechecked on every attempt.
    let eligible:bool=sqlx::query_scalar(r#"SELECT EXISTS(SELECT 1 FROM marketing_consent WHERE mobile=r.mobile AND granted AND version=r.consent_version) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.customers) e LEFT JOIN customers c ON c.id=(e->>'id')::uuid WHERE c.id IS NULL OR c.mobile_no <> e->>'mobileNo') FROM campaign_recipients r WHERE id=$1"#).bind(job.id).fetch_one(&mut *tx).await?;
    if !eligible {
        sqlx::query("UPDATE campaign_recipients SET state='skipped',error_message='Consent or customer phone changed.',updated_at=now() WHERE id=$1").bind(job.id).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(None);
    }
    sqlx::query("UPDATE campaign_dispatch_clock SET next_at=clock_timestamp()+make_interval(secs=>$1::double precision / 1000) WHERE id=true").bind(interval_ms as f64).execute(&mut *tx).await?;
    sqlx::query("UPDATE campaign_recipients SET state='submitting',attempt_count=attempt_count+1,lease_until=now()+interval '3 minutes',request_started=false,updated_at=now() WHERE id=$1").bind(job.id).execute(&mut *tx).await?;
    job.attempt_count += 1;
    sqlx::query("INSERT INTO campaign_attempts(recipient_id,attempt_number) VALUES($1,$2)")
        .bind(job.id)
        .bind(job.attempt_count)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE campaigns SET state='sending',blocked_reason=NULL WHERE id=$1")
        .bind(job.campaign_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(job))
}
pub async fn request_started(db: &PgPool, job: &Job) -> Result<bool, AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    let valid:bool=sqlx::query_scalar("SELECT r.state='submitting' AND r.lease_until > now() AND c.state NOT IN ('cancelled','expired') AND c.expires_at > now() AND COALESCE(m.granted AND m.version=r.consent_version,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.customers) e LEFT JOIN customers source ON source.id=(e->>'id')::uuid WHERE source.id IS NULL OR source.mobile_no <> e->>'mobileNo') FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id LEFT JOIN marketing_consent m ON m.mobile=r.mobile WHERE r.id=$1 FOR UPDATE OF r").bind(job.id).fetch_one(&mut *tx).await?;
    if valid {
        sqlx::query("UPDATE campaign_recipients SET request_started=true WHERE id=$1")
            .bind(job.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(valid)
}
pub async fn finish(
    db: &PgPool,
    job: &Job,
    state: &str,
    message_id: Option<&str>,
    error: Option<&str>,
    delay: i64,
) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE campaign_recipients SET state=$2,provider_message_id=COALESCE($3,provider_message_id),error_message=$4,available_at=now()+make_interval(secs=>$5::double precision),lease_until=NULL,updated_at=now() WHERE id=$1 AND attempt_count=$6 AND (state='submitting' OR (state='uncertain' AND $3::text IS NOT NULL))").bind(job.id).bind(state).bind(message_id).bind(error).bind(delay as f64).bind(job.attempt_count).execute(&mut *tx).await?;
    sqlx::query("UPDATE campaign_attempts SET finished_at=now(),outcome=$3,provider_message_id=$4,error_message=$5 WHERE recipient_id=$1 AND attempt_number=$2").bind(job.id).bind(job.attempt_count).bind(state).bind(message_id).bind(error).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn block(db: &PgPool, id: Uuid, reason: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE campaigns SET state='blocked',blocked_reason=$2 WHERE id=$1 AND state NOT IN ('cancelled','completed','expired')").bind(id).bind(reason).execute(db).await?;
    Ok(())
}
pub async fn delivery_event(
    db: &mut PgConnection,
    id: &str,
    incoming: &str,
    error: Option<&str>,
) -> Result<bool, AppError> {
    let existing: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id,state FROM campaign_recipients WHERE provider_message_id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *db)
    .await?;
    if let Some((recipient, current)) = existing {
        if let Some(next) = crate::features::notifications::worker::next_status(&current, incoming)
        {
            sqlx::query("UPDATE campaign_recipients SET state=$2,error_message=$3,updated_at=now() WHERE id=$1").bind(recipient).bind(next).bind(error).execute(db).await?;
        }
        return Ok(true);
    }
    Ok(false)
}
pub async fn attribute_unsubscribe(
    db: &mut PgConnection,
    mobile: &str,
    context: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    // Attribute to the button's referenced message, or the most recent prior campaign.
    sqlx::query("UPDATE campaign_recipients SET unsubscribed_at=$3 WHERE id=(SELECT id FROM campaign_recipients WHERE mobile=$1 AND provider_message_id IS NOT NULL AND updated_at < $3 + interval '1 second' AND ($2::text IS NULL OR provider_message_id=$2) ORDER BY updated_at DESC LIMIT 1)").bind(mobile).bind(context).bind(at).execute(db).await?;
    Ok(())
}
pub async fn sync_template(
    db: &PgPool,
    name: &str,
    language: &str,
    provider_id: &str,
    definition: &TemplateDefinition,
    state: &str,
    reason: Option<&str>,
    components: &Value,
) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    let existing:Option<(Uuid,Option<Value>,Value)>=sqlx::query_as("SELECT id,provider_components,definition FROM campaign_templates WHERE name=$1 AND language=$2 FOR UPDATE").bind(name).bind(language).fetch_optional(&mut *tx).await?;
    if let Some((id, old, original)) = existing {
        let changed = old.as_ref().is_some_and(|v| v != components);
        let mut d = definition.clone();
        d.examples = serde_json::from_value(original["examples"].clone()).unwrap_or_default();
        d.sample_asset_id = original["sampleAssetId"]
            .as_str()
            .and_then(|v| v.parse().ok());
        sqlx::query("UPDATE campaign_templates SET provider_id=$2,state=$3,rejection_reason=$4,provider_components=$5,definition=$6,synced_at=now(),revision=CASE WHEN $7 THEN $8 ELSE revision END WHERE id=$1").bind(id).bind(provider_id).bind(state).bind(reason).bind(components).bind(json!(d)).bind(changed).bind(Uuid::new_v4()).execute(&mut *tx).await?;
    } else {
        sqlx::query("INSERT INTO campaign_templates(name,language,definition,state,provider_id,provider_components,rejection_reason,created_by,synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,'meta-sync',now())").bind(name).bind(language).bind(json!(definition)).bind(state).bind(provider_id).bind(components).bind(reason).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
pub async fn mark_template_unknown(db: &PgPool, id: Uuid, reason: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE campaign_templates SET state='unknown',rejection_reason=$2,synced_at=now() WHERE id=$1").bind(id).bind(reason).execute(db).await?;
    Ok(())
}

pub async fn excluded_mobiles(
    db: &mut PgConnection,
    ids: &[Uuid],
) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT mobile_no FROM customers WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(db)
            .await?,
    )
}

pub async fn dispatch_rejection(db: &PgPool, job: &Job) -> Result<&'static str, AppError> {
    let campaign_state: String = sqlx::query_scalar("SELECT CASE WHEN state='cancelled' THEN state WHEN expires_at <= now() THEN 'expired' ELSE state END FROM campaigns WHERE id=$1")
        .bind(job.campaign_id)
        .fetch_one(db)
        .await?;
    Ok(match campaign_state.as_str() {
        "cancelled" => "cancelled",
        "expired" => "expired",
        _ => "skipped",
    })
}

pub async fn begin_delivery(db: &PgPool, job: &Job) -> Result<i32, AppError> {
    // Template availability checks do not consume the bounded delivery budget.
    Ok(sqlx::query_scalar("UPDATE campaign_recipients SET delivery_attempts=delivery_attempts+1 WHERE id=$1 AND state='submitting' AND attempt_count=$2 RETURNING delivery_attempts").bind(job.id).bind(job.attempt_count).fetch_one(db).await?)
}
