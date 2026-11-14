//! Shared, phone-scoped WhatsApp preferences. Missing invoice settings retain
//! the historical enabled default; marketing still requires a saved opt-in.
use super::phone;
use crate::error::AppError;
use chrono::Utc;
use sqlx::{PgConnection, PgPool};
use std::collections::BTreeMap;
use uuid::Uuid;

pub async fn lock(db: &mut PgConnection) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(842101)")
        .execute(db)
        .await?;
    Ok(())
}

pub async fn invoice_enabled(db: &mut PgConnection, mobile: &str) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar("SELECT COALESCE((SELECT invoice_updates_enabled FROM whatsapp_preferences WHERE mobile=$1),true)")
        .bind(mobile).fetch_one(db).await?)
}

pub async fn save_invoice(
    db: &mut PgConnection,
    mobile: &str,
    enabled: bool,
    initialize: bool,
    actor: &str,
) -> Result<(), AppError> {
    save_invoice_with_source(
        db,
        mobile,
        enabled,
        initialize,
        actor,
        "Customer form invoice/pickup checkbox",
    )
    .await
}

async fn save_invoice_with_source(
    db: &mut PgConnection,
    mobile: &str,
    enabled: bool,
    initialize: bool,
    actor: &str,
    source: &str,
) -> Result<(), AppError> {
    let previous: Option<(bool, Option<Uuid>)> = sqlx::query_as(
        "SELECT invoice_updates_enabled,invoice_version FROM whatsapp_preferences WHERE mobile=$1",
    )
    .bind(mobile)
    .fetch_optional(&mut *db)
    .await?;
    if previous.is_some_and(|(current, version)| {
        (initialize && !current && enabled) || (version.is_some() && current == enabled)
    }) {
        return Ok(());
    }
    sqlx::query("INSERT INTO whatsapp_preferences(mobile,invoice_updates_enabled,invoice_version,invoice_updated_at,invoice_recorded_by) VALUES($1,$2,$3,now(),$4) ON CONFLICT(mobile) DO UPDATE SET invoice_updates_enabled=$2,invoice_version=$3,invoice_updated_at=now(),invoice_recorded_by=$4,updated_at=now()")
        .bind(mobile).bind(enabled).bind(Uuid::new_v4()).bind(actor).execute(&mut *db).await?;
    sqlx::query("INSERT INTO whatsapp_preference_events(mobile,enabled,category,observed_at,source,recorded_by) VALUES($1,$2,'invoice_updates',$3,$4,$5)")
        .bind(mobile).bind(enabled).bind(Utc::now()).bind(source).bind(actor).execute(db).await?;
    Ok(())
}

/// Runs after schema migration/seeding and before any API or worker starts.
/// Shared legacy opt-outs win; repeat startup never replays the old values.
pub async fn initialize(db: &PgPool, region: &str) -> Result<(), AppError> {
    region.parse::<phonenumber::country::Id>().map_err(|_| {
        AppError::Config("Invalid WHATSAPP_DEFAULT_REGION for preference migration.".into())
    })?;
    let mut tx = db.begin().await?;
    lock(&mut tx).await?;
    let customers: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id,mobile_no FROM customers WHERE whatsapp_mobile IS NULL")
            .fetch_all(&mut *tx)
            .await?;
    for (id, raw) in customers {
        if let Some(mobile) = phone::normalize(&raw, region) {
            sqlx::query("UPDATE customers SET whatsapp_mobile=$2 WHERE id=$1")
                .bind(id)
                .bind(mobile)
                .execute(&mut *tx)
                .await?;
        }
    }
    let legacy: Vec<(String, bool)> =
        sqlx::query_as("SELECT mobile_no,enabled FROM whatsapp_preference_backfill")
            .fetch_all(&mut *tx)
            .await?;
    let mut grouped = BTreeMap::new();
    for (raw, enabled) in legacy {
        if let Some(mobile) = phone::normalize(&raw, region) {
            grouped
                .entry(mobile)
                .and_modify(|current| *current = *current && enabled)
                .or_insert(enabled);
        } else {
            sqlx::query("INSERT INTO whatsapp_preference_events(mobile,enabled,category,observed_at,source,recorded_by) VALUES($1,$2,'invoice_updates',now(),'Unparseable legacy customer number','Migration from customer preferences')")
                .bind(raw).bind(enabled).execute(&mut *tx).await?;
        }
    }
    for (mobile, enabled) in grouped {
        let enabled = enabled && invoice_enabled(&mut tx, &mobile).await?;
        save_invoice_with_source(
            &mut tx,
            &mobile,
            enabled,
            true,
            "Migration from customer preferences",
            "Legacy customer invoice/pickup preference migration",
        )
        .await?;
    }
    sqlx::query("DELETE FROM whatsapp_preference_backfill")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
