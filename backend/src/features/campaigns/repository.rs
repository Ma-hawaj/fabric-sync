use super::types::*;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

// Consent writes, approvals and dispatch claims share one short lock. No HTTP
// request is made while holding it. The submitting claim is the opt-out cutoff.
pub async fn consent_lock(db: &mut PgConnection) -> Result<(), AppError> {
    crate::features::notifications::preferences::lock(db).await
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
    use crate::features::notifications::{
        repository as queue,
        types::{QuickReply, Snapshot},
    };
    let request:Uuid=sqlx::query_scalar("INSERT INTO notification_requests(kind,campaign_id,origin) VALUES('campaign',$1,'manual') RETURNING id").bind(c.id).fetch_one(&mut *db).await?;
    let hash = crate::features::notifications::service::hash(
        &serde_json::to_vec(p).map_err(|e| AppError::Config(e.to_string()))?,
    );
    let artifact = if let Some(asset) = p.asset_id {
        Some(sqlx::query_scalar::<_,Uuid>("INSERT INTO document_artifacts(campaign_id,source_hash,filename,mime_type,sha256,byte_length,content) SELECT $1,$2,filename,mime_type,sha256,octet_length(content),content FROM campaign_assets WHERE id=$3 RETURNING id").bind(c.id).bind(&hash).bind(asset).fetch_one(&mut *db).await?)
    } else {
        None
    };
    let snapshot = Snapshot {
        repair_id: None,
        invoice_number: None,
        source_hash: hash,
        revision: 0,
        body: p.body.clone(),
        template_name: p.template.name.clone(),
        language: p.template.language.clone(),
        parameters: p.parameters.clone(),
        exclusions: vec![],
        quick_replies: vec![QuickReply {
            index: u8::from(p.template.definition.website_url.is_some()),
            payload: "MARKETING_UNSUBSCRIBE".into(),
        }],
    };
    let notification = queue::insert_send(
        db,
        queue::NewSend {
            request,
            kind: "campaign",
            event_key: &format!("campaign:{}", c.id),
            command: Some(input.request_id),
            snapshot: &snapshot,
            artifact,
            actor,
            resend_of: None,
        },
    )
    .await?;
    for d in &p.destinations {
        sqlx::query("INSERT INTO notification_recipients(notification_id,normalized_mobile,customers,marketing_consent_version,status,next_attempt_at) VALUES($1,$2,$3,$4,'queued',COALESCE($5,now()))").bind(notification).bind(&d.mobile).bind(json!(d.customers)).bind(d.consent_version).bind(p.send_at).execute(&mut *db).await?;
    }
    queue::approve(db, notification, actor).await?;
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
        let sends: Vec<Uuid> =
            sqlx::query_scalar("SELECT id FROM notifications WHERE campaign_id=$1")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        for send in sends {
            crate::features::notifications::repository::cancel(&mut tx, send).await?;
        }
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
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO whatsapp_preference_events(mobile,enabled,observed_at,source,recorded_by,provider_event_id,category) VALUES($1,$2,$3,$4,$5,$6,'marketing') ON CONFLICT(provider_event_id) DO NOTHING RETURNING id").bind(mobile).bind(granted).bind(observed_at).bind(source).bind(actor).bind(event).fetch_optional(&mut *db).await?;
    if inserted.is_none() {
        return Ok(());
    }
    // Old provider events must never undo a later explicit opt-in/withdrawal.
    let changed=sqlx::query("INSERT INTO whatsapp_preferences(mobile,marketing_enabled,marketing_observed_at,marketing_source,marketing_recorded_by,marketing_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(mobile) DO UPDATE SET marketing_enabled=$2,marketing_observed_at=$3,marketing_source=$4,marketing_recorded_by=$5,marketing_version=$6,updated_at=now() WHERE whatsapp_preferences.marketing_version IS NULL OR whatsapp_preferences.marketing_observed_at <= $3 OR (NOT $2 AND date_trunc('second',whatsapp_preferences.marketing_observed_at)=date_trunc('second',$3::timestamptz))").bind(mobile).bind(granted).bind(observed_at).bind(source).bind(actor).bind(Uuid::new_v4()).execute(&mut *db).await?;
    if !granted && changed.rows_affected() > 0 {
        sqlx::query("UPDATE notification_recipients r SET status='skipped',error_message='Marketing consent withdrawn.',updated_at=now() FROM notifications n WHERE n.id=r.notification_id AND n.kind='campaign' AND r.normalized_mobile=$1 AND r.status='queued'").bind(mobile).execute(&mut *db).await?;
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
    let rows:Vec<Value>=sqlx::query_scalar("SELECT (to_jsonb(r) - 'marketing_consent_version') || jsonb_build_object('mobile',r.normalized_mobile,'state',r.status) FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE n.campaign_id=$1 ORDER BY r.normalized_mobile LIMIT $2 OFFSET $3").bind(id).bind(p.limit()).bind(p.offset()).fetch_all(db).await?;
    let counts:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_object_agg(status,n),'{}') FROM (SELECT r.status,count(*) AS n FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE n.campaign_id=$1 GROUP BY r.status) s").bind(id).fetch_one(db).await?;
    let (total,unsubscribes):(i64,i64)=sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE r.unsubscribed_at IS NOT NULL) FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE n.campaign_id=$1").bind(id).fetch_one(db).await?;
    Ok(json!({"items":rows,"total":total,"counts":counts,"unsubscribes":unsubscribes}))
}

pub async fn maintenance(db: &PgPool) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    // Follow the dispatch/approval lock order: campaign, send, recipient.
    sqlx::query("SELECT id FROM campaigns WHERE state IN ('scheduled','sending','blocked') ORDER BY id FOR UPDATE").execute(&mut *tx).await?;
    sqlx::query("UPDATE notification_recipients r SET status='expired',updated_at=now() FROM notifications n JOIN campaigns c ON c.id=n.campaign_id WHERE n.id=r.notification_id AND c.expires_at <= now() AND r.status='queued'").execute(&mut *tx).await?;
    sqlx::query("UPDATE campaigns c SET state=CASE WHEN expires_at <= now() THEN 'expired' ELSE 'completed' END WHERE state IN ('scheduled','sending','blocked') AND NOT EXISTS(SELECT 1 FROM notifications n JOIN notification_recipients r ON r.notification_id=n.id WHERE n.campaign_id=c.id AND r.status IN ('queued','submitting'))").execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn block(db: &PgPool, id: Uuid, reason: &str) -> Result<(), AppError> {
    let mut tx = db.begin().await?;
    consent_lock(&mut tx).await?;
    campaign(&mut tx, id, true).await?;
    sqlx::query("UPDATE campaigns SET state='blocked',blocked_reason=$2 WHERE id=$1 AND state IN ('scheduled','sending','blocked')").bind(id).bind(reason).execute(&mut *tx).await?;
    sqlx::query("UPDATE notification_recipients r SET next_attempt_at=now()+interval '60 seconds',error_message=$2 FROM notifications n WHERE n.id=r.notification_id AND n.campaign_id=$1 AND r.status='queued'").bind(id).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn attribute_unsubscribe(
    db: &mut PgConnection,
    mobile: &str,
    context: Option<&str>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE notification_recipients SET unsubscribed_at=$3 WHERE id=(SELECT r.id FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE n.kind='campaign' AND r.normalized_mobile=$1 AND r.provider_message_id IS NOT NULL AND r.updated_at < $3 + interval '1 second' AND ($2::text IS NULL OR r.provider_message_id=$2) ORDER BY r.updated_at DESC LIMIT 1)").bind(mobile).bind(context).bind(at).execute(db).await?;
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

pub async fn eligible(
    db: &mut PgConnection,
    campaign: Uuid,
    recipient: Uuid,
) -> Result<Option<&'static str>, AppError> {
    let (state,expired,eligible):(String,bool,bool)=sqlx::query_as("SELECT c.state,c.expires_at <= now(),COALESCE(m.granted AND m.version=r.marketing_consent_version,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.customers) e LEFT JOIN customers source ON source.id=(e->>'id')::uuid WHERE source.id IS NULL OR source.mobile_no <> e->>'mobileNo') FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id JOIN campaigns c ON c.id=n.campaign_id LEFT JOIN marketing_consent m ON m.mobile=r.normalized_mobile WHERE r.id=$1 AND c.id=$2").bind(recipient).bind(campaign).fetch_one(db).await?;
    Ok(if state == "cancelled" {
        Some("cancelled")
    } else if expired {
        Some("expired")
    } else if !eligible {
        Some("skipped")
    } else {
        None
    })
}
pub async fn reserve(db: &mut PgConnection, id: Uuid, interval_ms: i64) -> Result<bool, AppError> {
    let ready: bool = sqlx::query_scalar(
        "SELECT next_at<=now() FROM campaign_dispatch_clock WHERE id=true FOR UPDATE",
    )
    .fetch_one(&mut *db)
    .await?;
    if ready {
        sqlx::query("UPDATE campaign_dispatch_clock SET next_at=clock_timestamp()+make_interval(secs=>$1::double precision/1000) WHERE id=true").bind(interval_ms as f64).execute(&mut *db).await?;
        sqlx::query("UPDATE campaigns SET state='sending',blocked_reason=NULL WHERE id=$1")
            .bind(id)
            .execute(db)
            .await?;
    }
    Ok(ready)
}

pub async fn exclude_queued(db: &mut PgConnection, id: Uuid, status: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE notification_recipients SET status=$2,error_message='Campaign expired, cancelled, or recipient consent/phone changed.',updated_at=now() WHERE id=$1 AND status='queued'").bind(id).bind(status).execute(db).await?;
    Ok(())
}
