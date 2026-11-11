use super::{provider, repository as store, service, types::*};
use crate::test_support;
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

fn definition() -> TemplateDefinition {
    serde_json::from_value(json!({"body":"Offer {{1}}","examples":["20%"],"imageHeader":false,"unsubscribeLabel":"Unsubscribe"})).unwrap()
}
fn input(id: Uuid) -> CampaignInput {
    serde_json::from_value(json!({"name":"Season promotion","templateId":id,"parameters":["20%"],"expiresAt":Utc::now()+Duration::days(2)})).unwrap()
}
#[test]
fn template_parameters_are_nonrecursive_and_exact() {
    assert_eq!(
        service::render("Save {{1}} with {{2}}", &["20%".into(), "CODE".into()]).unwrap(),
        "Save 20% with CODE"
    );
    for (body, params) in [
        ("{{0}}", vec!["x".into()]),
        ("{{2}}", vec!["x".into(), "y".into()]),
        ("{{1}}", vec!["{{2}}".into()]),
        ("{{1", vec!["x".into()]),
    ] {
        assert!(service::render(body, &params).is_err());
    }
}
#[test]
fn validates_filters_and_deadlines() {
    let mut c = input(Uuid::new_v4());
    assert!(service::validate_campaign(&c).is_ok());
    c.audience.min_spend = Some("NaN".into());
    assert!(service::validate_campaign(&c).is_err());
    c.audience.min_spend = Some("10.01".into());
    c.audience.max_spend = Some("10.00".into());
    assert!(service::validate_campaign(&c).is_err());
    c.audience = AudienceFilter::default();
    c.send_at = Some(c.expires_at);
    assert!(service::validate_campaign(&c).is_err());
}
#[test]
fn template_components_preserve_buttons_and_reject_unsupported_formats() {
    let d = definition();
    let c = provider::components(&d, None);
    assert_eq!(
        provider::definition(&c).unwrap().unsubscribe_label,
        "Unsubscribe"
    );
    assert_eq!(provider::canonical(&c)[0].get("example"), None);
    assert!(provider::definition(&json!([{"type":"HEADER","format":"VIDEO"}])).is_none());
    assert!(service::is_unsubscribe(&json!({"text":{"body":" stop "}})));
    assert!(service::is_unsubscribe(
        &json!({"button":{"payload":"MARKETING_UNSUBSCRIBE"}})
    ));
    assert!(!service::is_unsubscribe(
        &json!({"text":{"body":"Please stop by tomorrow"}})
    ));
}
async fn setup(pool: &PgPool) -> (crate::state::AppState, Uuid, Uuid) {
    let state = test_support::state(pool.clone(), None, Some("http://127.0.0.1:1".into())).await;
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Campaign Customer','33112233') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let t = store::save_template(
        pool,
        None,
        &TemplateInput {
            name: "promotion_v1".into(),
            language: "en_US".into(),
            definition: definition(),
            expected_revision: None,
        },
        "sales",
    )
    .await
    .unwrap();
    store::submitted(
        pool,
        t.id,
        Some("template-id"),
        "approved",
        None,
        &provider::canonical(&provider::components(&t.definition, None)),
    )
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    store::record_consent(
        &mut tx,
        "+97333112233",
        true,
        Utc::now(),
        "Written request",
        "sales",
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (state, customer, t.id)
}
#[sqlx::test]
async fn approval_is_atomic_idempotent_and_freezes_unique_destinations(pool: PgPool) {
    let (state, _, template) = setup(&pool).await;
    sqlx::query("INSERT INTO customers(name,mobile_no) VALUES('Shared Customer','+973 3311 2233')")
        .execute(&pool)
        .await
        .unwrap();
    let c = store::save_campaign(&pool, None, &input(template), "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    assert_eq!(p.destinations.len(), 1);
    assert_eq!(p.destinations[0].customers.len(), 2);
    let request = Uuid::new_v4();
    for _ in 0..2 {
        let result = service::approve(
            &state,
            c.id,
            ApproveInput {
                expected_revision: c.revision,
                preview_version: p.version,
                request_id: request,
            },
            "manager",
        )
        .await
        .unwrap();
        assert_eq!(result.state, "scheduled");
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM campaign_recipients WHERE campaign_id=$1")
            .bind(c.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    assert!(
        store::save_campaign(&pool, Some(c.id), &input(template), "sales")
            .await
            .is_err()
    );
}
#[sqlx::test]
async fn stale_consent_rejects_approval_and_unsubscribe_suppresses_queue(pool: PgPool) {
    let (state, _, template) = setup(&pool).await;
    let c = store::save_campaign(&pool, None, &input(template), "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    let event = json!({"entry":[{"changes":[{"value":{"messages":[{"id":"unsubscribe-1","from":"97333112233","timestamp":Utc::now().timestamp().to_string(),"text":{"body":"STOP"}}]}}]}]});
    service::webhook(&pool, &event).await.unwrap();
    service::webhook(&pool, &event).await.unwrap();
    assert!(service::approve(
        &state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4()
        },
        "manager"
    )
    .await
    .is_err());
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM marketing_consent_events WHERE provider_event_id='unsubscribe-1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(events, 1);
}
#[sqlx::test]
async fn claim_exclusive_cancellation_deadline_and_lease_recovery(pool: PgPool) {
    let (state, _, template) = setup(&pool).await;
    let c = store::save_campaign(&pool, None, &input(template), "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    service::approve(
        &state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4(),
        },
        "manager",
    )
    .await
    .unwrap();
    let (a, b) = tokio::join!(store::claim(&pool, 1000), store::claim(&pool, 1000));
    assert_eq!(
        usize::from(a.unwrap().is_some()) + usize::from(b.unwrap().is_some()),
        1
    );
    sqlx::query(
        "UPDATE campaign_recipients SET request_started=true,lease_until=now()-interval '1 second'",
    )
    .execute(&pool)
    .await
    .unwrap();
    store::maintenance(&pool).await.unwrap();
    let status: String =
        sqlx::query_scalar("SELECT state FROM campaign_recipients WHERE campaign_id=$1")
            .bind(c.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "uncertain");
    assert!(store::claim(&pool, 1000).await.unwrap().is_none());
}
#[sqlx::test]
async fn segmentation_deduplicates_associated_invoices_and_credits(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 2, false).await;
    sqlx::query("UPDATE invoices SET issuing_branch_id=$2 WHERE id=$1")
        .bind(invoice)
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let filter = AudienceFilter {
        min_purchases: Some(1),
        min_spend: Some("200.00".into()),
        branch_id: Some(branch),
        ..Default::default()
    };
    let rows = store::audience(&mut *pool.acquire().await.unwrap(), &filter, "Asia/Bahrain")
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].purchase_count, 1);
    let value: Value = store::recipients(
        &pool,
        Uuid::new_v4(),
        &Pagination {
            page: 1,
            per_page: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(value["total"], 0);
}

#[derive(Clone)]
struct MetaMock {
    definition: std::sync::Arc<std::sync::Mutex<TemplateDefinition>>,
    status: std::sync::Arc<std::sync::Mutex<String>>,
    messages: std::sync::Arc<std::sync::Mutex<Vec<Value>>>,
    mode: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl MetaMock {
    fn new() -> Self {
        Self {
            definition: std::sync::Arc::new(std::sync::Mutex::new(definition())),
            status: std::sync::Arc::new(std::sync::Mutex::new("APPROVED".into())),
            messages: Default::default(),
            mode: Default::default(),
        }
    }
    fn value(&self) -> Value {
        json!({"id":"template-id","name":"promotion_v1","language":"en_US","status":*self.status.lock().unwrap(),"category":"MARKETING","components":provider::components(&self.definition.lock().unwrap(),None)})
    }
}
async fn meta_template(
    axum::extract::State(m): axum::extract::State<MetaMock>,
) -> axum::Json<Value> {
    axum::Json(m.value())
}
async fn meta_list(axum::extract::State(m): axum::extract::State<MetaMock>) -> axum::Json<Value> {
    axum::Json(json!({"data":[m.value()]}))
}
async fn meta_submit(axum::Json(v): axum::Json<Value>) -> axum::Json<Value> {
    assert_eq!(v["category"], "MARKETING");
    assert_eq!(v["allow_category_change"], false);
    axum::Json(json!({"id":"template-id","status":"PENDING"}))
}
async fn meta_send(
    axum::extract::State(m): axum::extract::State<MetaMock>,
    axum::Json(v): axum::Json<Value>,
) -> (
    axum::http::StatusCode,
    [(&'static str, &'static str); 1],
    axum::Json<Value>,
) {
    m.messages.lock().unwrap().push(v);
    match m.mode.load(std::sync::atomic::Ordering::SeqCst) {
        1 => (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            [("retry-after", "600")],
            axum::Json(json!({"error":{"message":"Rate limited","code":130429}})),
        ),
        2 => (
            axum::http::StatusCode::OK,
            [("retry-after", "0")],
            axum::Json(json!({})),
        ),
        _ => (
            axum::http::StatusCode::OK,
            [("retry-after", "0")],
            axum::Json(json!({"messages":[{"id":"campaign-message-1"}]})),
        ),
    }
}
async fn meta_server(mock: MetaMock) -> (String, tokio::task::JoinHandle<()>) {
    let router = axum::Router::new()
        .route("/template-id", axum::routing::get(meta_template))
        .route(
            "/test-waba/message_templates",
            axum::routing::get(meta_list).post(meta_submit),
        )
        .route("/test-phone/messages", axum::routing::post(meta_send))
        .route(
            "/test-phone/media",
            axum::routing::post(|| async { axum::Json(json!({"id":"image-media"})) }),
        )
        .route(
            "/test-app/uploads",
            axum::routing::post(|| async { axum::Json(json!({"id":"upload:sample"})) }),
        )
        .route(
            "/upload:sample",
            axum::routing::post(|| async { axum::Json(json!({"h":"sample-handle"})) }),
        )
        .with_state(mock);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{addr}"), task)
}
async fn approved_campaign(
    pool: &PgPool,
    state: &crate::state::AppState,
    template: Uuid,
) -> Campaign {
    let c = store::save_campaign(pool, None, &input(template), "sales")
        .await
        .unwrap();
    let p = service::preview(state, c.id).await.unwrap();
    service::approve(
        state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4(),
        },
        "manager",
    )
    .await
    .unwrap()
}
#[sqlx::test]
async fn exact_provider_payload_and_monotonic_status_webhooks(pool: PgPool) {
    let (_, _, template) = setup(&pool).await;
    let mock = MetaMock::new();
    let (url, server) = meta_server(mock.clone()).await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let c = approved_campaign(&pool, &state, template).await;
    assert_eq!(mock.messages.lock().unwrap().len(), 0);
    super::worker::tick(&state).await.unwrap();
    let payload = mock.messages.lock().unwrap()[0].clone();
    assert_eq!(payload["to"], "97333112233");
    assert_eq!(payload["template"]["name"], "promotion_v1");
    assert_eq!(
        payload["template"]["components"][0]["parameters"][0]["text"],
        "20%"
    );
    assert_eq!(
        payload["template"]["components"][1]["parameters"][0]["payload"],
        "MARKETING_UNSUBSCRIBE"
    );
    for status in ["read", "delivered", "sent"] {
        let event = json!({"entry":[{"changes":[{"value":{"statuses":[{"id":"campaign-message-1","status":status}]}}]}]});
        crate::features::notifications::worker::receive_webhook(
            &pool,
            &serde_json::to_vec(&event).unwrap(),
        )
        .await
        .unwrap();
    }
    let r = store::recipients(
        &pool,
        c.id,
        &Pagination {
            page: 1,
            per_page: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(r["counts"]["read"], 1);
    super::worker::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    server.abort();
}
#[sqlx::test]
async fn rate_limits_retry_but_ambiguous_results_never_replay(pool: PgPool) {
    let (_, _, template) = setup(&pool).await;
    let mock = MetaMock::new();
    mock.mode.store(1, std::sync::atomic::Ordering::SeqCst);
    let (url, server) = meta_server(mock.clone()).await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let c = approved_campaign(&pool, &state, template).await;
    super::worker::tick(&state).await.unwrap();
    let row:(String,bool)=sqlx::query_as("SELECT state,available_at >= now()+interval '590 seconds' FROM campaign_recipients WHERE campaign_id=$1").bind(c.id).fetch_one(&pool).await.unwrap();
    assert_eq!(row, ("queued".into(), true));
    sqlx::query("UPDATE campaign_recipients SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE campaign_dispatch_clock SET next_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    mock.mode.store(2, std::sync::atomic::Ordering::SeqCst);
    super::worker::tick(&state).await.unwrap();
    let result = store::recipients(
        &pool,
        c.id,
        &Pagination {
            page: 1,
            per_page: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(result["counts"]["uncertain"], 1);
    super::worker::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    server.abort();
}
#[sqlx::test]
async fn paused_templates_block_and_external_content_changes_invalidate_frozen_version(
    pool: PgPool,
) {
    let (_, _, template) = setup(&pool).await;
    let mock = MetaMock::new();
    let (url, server) = meta_server(mock.clone()).await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let c = approved_campaign(&pool, &state, template).await;
    *mock.status.lock().unwrap() = "PAUSED".into();
    super::worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(
        store::campaign(&mut *pool.acquire().await.unwrap(), c.id, false)
            .await
            .unwrap()
            .state,
        "blocked"
    );
    *mock.status.lock().unwrap() = "APPROVED".into();
    mock.definition.lock().unwrap().body = "Changed {{1}}".into();
    sqlx::query("UPDATE campaign_recipients SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE campaign_dispatch_clock SET next_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    super::worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    server.abort();
}
#[sqlx::test]
async fn template_submission_sync_and_image_payload(pool: PgPool) {
    let (state, _, old) = setup(&pool).await;
    let mut db = pool.acquire().await.unwrap();
    store::archive_template(&pool, old).await.unwrap();
    sqlx::query("DELETE FROM campaign_templates WHERE id=$1")
        .bind(old)
        .execute(&mut *db)
        .await
        .unwrap();
    drop(db);
    let image = service::upload(
        &state,
        AssetInput {
            filename: "offer.png".into(),
            mime_type: "image/png".into(),
            data_base64: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                b"\x89PNG\r\n\x1a\nimage",
            ),
        },
        "sales",
    )
    .await
    .unwrap();
    let mock = MetaMock::new();
    mock.definition.lock().unwrap().image_header = true;
    mock.definition.lock().unwrap().sample_asset_id = Some(image.id);
    let (url, server) = meta_server(mock.clone()).await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let t = store::save_template(
        &pool,
        None,
        &TemplateInput {
            name: "promotion_v1".into(),
            language: "en_US".into(),
            definition: mock.definition.lock().unwrap().clone(),
            expected_revision: None,
        },
        "sales",
    )
    .await
    .unwrap();
    assert_eq!(
        provider::submit(&state, t.id).await.unwrap().state,
        "pending"
    );
    assert_eq!(provider::sync(&state).await.unwrap(), 1);
    let mut c = input(t.id);
    c.asset_id = Some(image.id);
    let c = store::save_campaign(&pool, None, &c, "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    service::approve(
        &state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4(),
        },
        "manager",
    )
    .await
    .unwrap();
    super::worker::tick(&state).await.unwrap();
    let sent = mock.messages.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert!(sent[0]["template"]["components"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["type"] == "header" && v["parameters"][0]["image"]["id"] == "image-media"));
    server.abort();
}
#[sqlx::test]
async fn withdrawal_after_approval_and_phone_changes_prevent_submission(pool: PgPool) {
    let (state, customer, template) = setup(&pool).await;
    let c = approved_campaign(&pool, &state, template).await;
    sqlx::query("UPDATE customers SET mobile_no='33991122' WHERE id=$1")
        .bind(customer)
        .execute(&pool)
        .await
        .unwrap();
    assert!(store::claim(&pool, 1000).await.unwrap().is_none());
    let r = store::recipients(
        &pool,
        c.id,
        &Pagination {
            page: 1,
            per_page: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(r["counts"]["skipped"], 1);
    sqlx::query("UPDATE customers SET mobile_no='33112233' WHERE id=$1")
        .bind(customer)
        .execute(&pool)
        .await
        .unwrap();
    let c = approved_campaign(&pool, &state, template).await;
    let mut tx = pool.begin().await.unwrap();
    store::record_consent(
        &mut tx,
        "+97333112233",
        false,
        Utc::now(),
        "Staff withdrawal",
        "sales",
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let r = store::recipients(
        &pool,
        c.id,
        &Pagination {
            page: 1,
            per_page: 50,
        },
    )
    .await
    .unwrap();
    assert_eq!(r["counts"]["skipped"], 1);
}
#[sqlx::test]
async fn scheduled_jobs_wait_and_deadlines_and_cancellation_are_durable(pool: PgPool) {
    let (state, _, template) = setup(&pool).await;
    let mut i = input(template);
    i.send_at = Some(Utc::now() + Duration::hours(1));
    let c = store::save_campaign(&pool, None, &i, "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    service::approve(
        &state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4(),
        },
        "manager",
    )
    .await
    .unwrap();
    assert!(store::claim(&pool, 1000).await.unwrap().is_none());
    store::cancel(&pool, c.id).await.unwrap();
    assert_eq!(
        store::recipients(
            &pool,
            c.id,
            &Pagination {
                page: 1,
                per_page: 50
            }
        )
        .await
        .unwrap()["counts"]["cancelled"],
        1
    );
    let c = approved_campaign(&pool, &state, template).await;
    sqlx::query("UPDATE campaigns SET expires_at=now()-interval '1 second' WHERE id=$1")
        .bind(c.id)
        .execute(&pool)
        .await
        .unwrap();
    store::maintenance(&pool).await.unwrap();
    assert_eq!(
        store::recipients(
            &pool,
            c.id,
            &Pagination {
                page: 1,
                per_page: 50
            }
        )
        .await
        .unwrap()["counts"]["expired"],
        1
    );
}

#[sqlx::test]
async fn competing_approvals_cannot_duplicate_a_campaign(pool: PgPool) {
    let (state, _, template) = setup(&pool).await;
    let c = store::save_campaign(&pool, None, &input(template), "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    let a = ApproveInput {
        expected_revision: c.revision,
        preview_version: p.version,
        request_id: Uuid::new_v4(),
    };
    let b = ApproveInput {
        expected_revision: c.revision,
        preview_version: p.version,
        request_id: Uuid::new_v4(),
    };
    let (a, b) = tokio::join!(
        service::approve(&state, c.id, a, "manager-a"),
        service::approve(&state, c.id, b, "manager-b")
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert_eq!(
        store::recipients(
            &pool,
            c.id,
            &Pagination {
                page: 1,
                per_page: 50
            }
        )
        .await
        .unwrap()["total"],
        1
    );
}

#[sqlx::test(migrations = false)]
async fn additive_migration_preserves_existing_customers_without_marketing_opt_in(pool: PgPool) {
    for sql in [
        include_str!("../../../migrations/0001_core_schema.sql"),
        include_str!("../../../migrations/0002_notification_schema.sql"),
        include_str!("../../../migrations/0003_readiness_and_revisions.sql"),
        include_str!("../../../migrations/0004_list_indexes.sql"),
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    }
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Existing Customer','33112233') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/0005_marketing_campaigns.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let enabled: bool =
        sqlx::query_scalar("SELECT whatsapp_notifications_enabled FROM customers WHERE id=$1")
            .bind(customer)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(enabled);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM marketing_consent")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[sqlx::test]
async fn corrupted_approved_images_are_never_submitted(pool: PgPool) {
    let (initial, _, old) = setup(&pool).await;
    let image = service::upload(
        &initial,
        AssetInput {
            filename: "offer.png".into(),
            mime_type: "image/png".into(),
            data_base64: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                b"\x89PNG\r\n\x1a\nimage",
            ),
        },
        "sales",
    )
    .await
    .unwrap();
    let mock = MetaMock::new();
    mock.definition.lock().unwrap().image_header = true;
    mock.definition.lock().unwrap().sample_asset_id = Some(image.id);
    let (url, server) = meta_server(mock.clone()).await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let image_definition = mock.definition.lock().unwrap().clone();
    let image_components = provider::canonical(&provider::components(&image_definition, None));
    sqlx::query("UPDATE campaign_templates SET definition=$2,provider_components=$3 WHERE id=$1")
        .bind(old)
        .bind(json!(image_definition))
        .bind(image_components)
        .execute(&pool)
        .await
        .unwrap();
    let mut i = input(old);
    i.asset_id = Some(image.id);
    let c = store::save_campaign(&pool, None, &i, "sales")
        .await
        .unwrap();
    let p = service::preview(&state, c.id).await.unwrap();
    service::approve(
        &state,
        c.id,
        ApproveInput {
            expected_revision: c.revision,
            preview_version: p.version,
            request_id: Uuid::new_v4(),
        },
        "manager",
    )
    .await
    .unwrap();
    sqlx::query("UPDATE campaign_assets SET content=$2 WHERE id=$1")
        .bind(image.id)
        .bind(b"corrupted-image".as_slice())
        .execute(&pool)
        .await
        .unwrap();
    super::worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(
        store::recipients(
            &pool,
            c.id,
            &Pagination {
                page: 1,
                per_page: 50
            }
        )
        .await
        .unwrap()["counts"]["failed"],
        1
    );
    server.abort();
}

#[sqlx::test]
async fn audience_count_uses_filters_consent_and_unique_mobiles_without_a_draft(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let customers: Vec<Uuid> = sqlx::query_scalar("INSERT INTO customers(name,mobile_no) VALUES('First','33112233'),('Shared','+973 3311 2233'),('No consent','33991122'),('Invalid','123') RETURNING id").fetch_all(&pool).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    store::record_consent(
        &mut tx,
        "+97333112233",
        true,
        Utc::now(),
        "Written request",
        "sales",
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let count = service::audience_count(&state, &AudienceFilter::default())
        .await
        .unwrap();
    assert_eq!(
        (
            count.message_count,
            count.matching_customers,
            count.excluded_customers
        ),
        (1, 4, 2)
    );
    let count = service::audience_count(
        &state,
        &AudienceFilter {
            min_purchases: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!((count.message_count, count.matching_customers), (0, 0));
    let count = service::audience_count(
        &state,
        &AudienceFilter {
            excluded_customer_ids: vec![customers[0]],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!((count.message_count, count.excluded_customers), (0, 4));
    let invalid = AudienceFilter {
        min_purchases: Some(2),
        max_purchases: Some(1),
        ..Default::default()
    };
    assert!(service::audience_count(&state, &invalid).await.is_err());
    let drafts: i64 = sqlx::query_scalar("SELECT count(*) FROM campaigns")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(drafts, 0);
}
