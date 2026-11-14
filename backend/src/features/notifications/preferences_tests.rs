use super::preferences;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn migration_merges_phone_formats_preserves_opt_outs_and_never_replays_legacy_values(
    pool: PgPool,
) {
    for migration in [
        include_str!("../../../migrations/0001_core_schema.sql"),
        include_str!("../../../migrations/0002_notification_schema.sql"),
        include_str!("../../../migrations/0003_readiness_and_revisions.sql"),
        include_str!("../../../migrations/0004_list_indexes.sql"),
        include_str!("../../../migrations/0005_marketing_campaigns.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO customers(name,mobile_no,whatsapp_notifications_enabled) VALUES('Local','33112233',true),('International','+973 3311 2233',false),('Prefix','00973-3311-2233',true),('Other','+966501234567',true),('Invalid','123',false)").execute(&pool).await.unwrap();
    let version:Uuid=sqlx::query_scalar("INSERT INTO marketing_consent(mobile,granted,observed_at,source,recorded_by) VALUES('+97333112233',true,now(),'Existing consent','sales') RETURNING version").fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO marketing_consent_events(mobile,granted,observed_at,source,recorded_by) VALUES('+97333112233',true,now(),'Existing consent','sales')").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/0006_phone_whatsapp_preferences.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    preferences::initialize(&pool, "BH").await.unwrap();
    let mut db = pool.acquire().await.unwrap();
    assert!(!preferences::invoice_enabled(&mut db, "+97333112233")
        .await
        .unwrap());
    let marketing = crate::features::campaigns::repository::consent(&mut db, "+97333112233")
        .await
        .unwrap()
        .unwrap();
    assert!(marketing.granted);
    assert_eq!(marketing.version, version);
    drop(db);
    let shared: i64 =
        sqlx::query_scalar("SELECT count(*) FROM customers WHERE whatsapp_mobile='+97333112233'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(shared, 3);
    let old_column:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='whatsapp_notifications_enabled')").fetch_one(&pool).await.unwrap();
    assert!(!old_column);
    let old_marketing_events: i64 =
        sqlx::query_scalar("SELECT count(*) FROM marketing_consent_events")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(old_marketing_events, 1);
    let invalid:i64=sqlx::query_scalar("SELECT count(*) FROM whatsapp_preference_events WHERE mobile='123' AND NOT enabled AND category='invoice_updates'").fetch_one(&pool).await.unwrap();
    assert_eq!(invalid, 1);
    let mut tx = pool.begin().await.unwrap();
    preferences::lock(&mut tx).await.unwrap();
    preferences::save_invoice(&mut tx, "+97333112233", true, false, "staff")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    preferences::initialize(&pool, "BH").await.unwrap();
    assert!(
        preferences::invoice_enabled(&mut *pool.acquire().await.unwrap(), "+97333112233")
            .await
            .unwrap()
    );
    let queue: i64 = sqlx::query_scalar("SELECT count(*) FROM whatsapp_preference_backfill")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(queue, 0);
}

#[sqlx::test]
async fn backfill_uses_the_configured_phone_region_and_does_not_grant_marketing(pool: PgPool) {
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('UK customer','020 8366 1177') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO whatsapp_preference_backfill(customer_id,mobile_no,enabled) VALUES($1,'020 8366 1177',false)").bind(customer).execute(&pool).await.unwrap();
    preferences::initialize(&pool, "GB").await.unwrap();
    let normalized: Option<String> =
        sqlx::query_scalar("SELECT whatsapp_mobile FROM customers WHERE id=$1")
            .bind(customer)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(normalized.as_deref(), Some("+442083661177"));
    let mut db = pool.acquire().await.unwrap();
    assert!(!preferences::invoice_enabled(&mut db, "+442083661177")
        .await
        .unwrap());
    assert!(
        crate::features::campaigns::repository::consent(&mut db, "+442083661177")
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test]
async fn invoice_and_marketing_settings_have_independent_versions_and_history(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let mut tx = pool.begin().await.unwrap();
    preferences::lock(&mut tx).await.unwrap();
    preferences::save_invoice(&mut tx, "+97333112233", false, false, "operator")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(crate::features::campaigns::repository::consent(
        &mut *pool.acquire().await.unwrap(),
        "+97333112233"
    )
    .await
    .unwrap()
    .is_none());
    let customer:Uuid=sqlx::query_scalar("INSERT INTO customers(name,mobile_no,whatsapp_mobile) VALUES('Shared phone','33112233','+97333112233') RETURNING id").fetch_one(&pool).await.unwrap();
    crate::features::campaigns::service::consent(
        &state,
        customer,
        serde_json::from_value(json!({"expectedMobile":"+97333112233","granted":true})).unwrap(),
        "sales",
    )
    .await
    .unwrap();
    let current = crate::features::campaigns::service::get_consent(&state, customer)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    preferences::lock(&mut tx).await.unwrap();
    preferences::save_invoice(&mut tx, "+97333112233", true, false, "operator")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let after = crate::features::campaigns::service::get_consent(&state, customer)
        .await
        .unwrap();
    assert_eq!(after["consent"]["version"], current["consent"]["version"]);
    let counts:Vec<(String,i64)>=sqlx::query_as("SELECT category,count(*) FROM whatsapp_preference_events GROUP BY category ORDER BY category").fetch_all(&pool).await.unwrap();
    assert_eq!(
        counts,
        vec![("invoice_updates".into(), 2), ("marketing".into(), 1)]
    );
}
