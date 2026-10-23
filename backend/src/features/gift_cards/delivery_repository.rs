use super::delivery::Preview;
use crate::features::notifications::Config;
use sqlx::{types::Json, FromRow, PgPool, PgTransaction};
use uuid::Uuid;

#[derive(FromRow)]
pub(super) struct Job {
    pub gift_card_id: Uuid,
    pub source_hash: String,
    pub normalized_mobile: String,
    pub parameters: Json<Vec<String>>,
    pub template_name: String,
    pub language: String,
    pub attempt_count: i32,
}

pub(super) async fn lock_card(tx: &mut PgTransaction<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM gift_cards WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?
            .is_some(),
    )
}

pub(super) async fn by_request(
    tx: &mut PgTransaction<'_>,
    request: Uuid,
) -> Result<Option<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as("SELECT gift_card_id,state FROM gift_card_deliveries WHERE request_id=$1")
        .bind(request)
        .fetch_optional(&mut **tx)
        .await
}

pub(super) async fn pending(tx: &mut PgTransaction<'_>, id: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM gift_card_deliveries WHERE gift_card_id=$1 AND state IN ('queued','sending'))")
        .bind(id).fetch_one(&mut **tx).await
}

pub(super) async fn insert(
    tx: &mut PgTransaction<'_>,
    id: Uuid,
    request: Uuid,
    actor: &str,
    preview: &Preview,
    config: &Config,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO gift_card_deliveries(gift_card_id,request_id,approved_by,source_hash,normalized_mobile,body,parameters,template_name,language) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(id).bind(request).bind(actor).bind(&preview.source_hash).bind(&preview.mobile).bind(&preview.body)
        .bind(Json(&preview.parameters)).bind(&config.gift_card_template).bind(&config.language)
        .execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn recover(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_card_deliveries SET state='uncertain',lease_until=NULL,last_error='The worker stopped during delivery. Check WhatsApp before resending.' WHERE state='sending' AND lease_until < now()")
        .execute(db).await?;
    Ok(())
}

pub(super) async fn candidate(db: &PgPool) -> Result<Option<(Uuid, Uuid)>, sqlx::Error> {
    sqlx::query_as("SELECT id,gift_card_id FROM gift_card_deliveries WHERE state='queued' AND available_at <= now() ORDER BY available_at,id LIMIT 1")
        .fetch_optional(db).await
}

pub(super) async fn lock_job(
    tx: &mut PgTransaction<'_>,
    id: Uuid,
) -> Result<Option<Job>, sqlx::Error> {
    sqlx::query_as("SELECT id,gift_card_id,source_hash,normalized_mobile,parameters,template_name,language,attempt_count FROM gift_card_deliveries WHERE id=$1 AND state='queued' AND available_at <= now() FOR UPDATE SKIP LOCKED")
        .bind(id).fetch_optional(&mut **tx).await
}

pub(super) async fn cancel(tx: &mut PgTransaction<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_card_deliveries SET state='cancelled',last_error='The gift card or recipient changed. Preview and send again.' WHERE id=$1")
        .bind(id).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn claim(tx: &mut PgTransaction<'_>, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_card_deliveries SET state='sending',attempt_count=attempt_count+1,lease_until=now()+interval '2 minutes' WHERE id=$1")
        .bind(id).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn finish(
    db: &PgPool,
    id: Uuid,
    state: &str,
    message_id: Option<&str>,
    error: Option<&str>,
    delay: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_card_deliveries SET state=$2,provider_message_id=$3,last_error=$4,lease_until=NULL,available_at=now()+make_interval(secs=>$5::float8) WHERE id=$1 AND state='sending'")
        .bind(id).bind(state).bind(message_id).bind(error).bind(delay as f64).execute(db).await?;
    Ok(())
}

pub(super) async fn lock_provider(
    tx: &mut PgTransaction<'_>,
    message_id: &str,
) -> Result<Option<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,state FROM gift_card_deliveries WHERE provider_message_id=$1 FOR UPDATE",
    )
    .bind(message_id)
    .fetch_optional(&mut **tx)
    .await
}

pub(super) async fn status(
    tx: &mut PgTransaction<'_>,
    id: Uuid,
    state: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_card_deliveries SET state=$2,last_error=$3 WHERE id=$1")
        .bind(id)
        .bind(state)
        .bind(error)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
