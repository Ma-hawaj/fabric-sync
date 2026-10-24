use super::{repository, service, types::*, worker};
use crate::{error::AppError, test_support};
use axum::{body::Bytes, extract::State, http::StatusCode, routing::post, Json, Router};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Mock {
    renders: Arc<AtomicUsize>,
    uploads: Arc<Mutex<Vec<Vec<u8>>>>,
    messages: Arc<Mutex<Vec<Value>>>,
    reject_next: Arc<AtomicBool>,
    missing_id: Arc<AtomicBool>,
}
async fn mock_renderer(
    State(mock): State<Mock>,
    body: Bytes,
) -> (StatusCode, [(&'static str, &'static str); 1], Vec<u8>) {
    mock.renders.fetch_add(1, Ordering::SeqCst);
    let pdf = format!("%PDF-1.4\n{}\n%%EOF", service::hash(&body)).into_bytes();
    (StatusCode::OK, [("content-type", "application/pdf")], pdf)
}
async fn mock_upload(State(mock): State<Mock>, body: Bytes) -> Json<Value> {
    mock.uploads.lock().unwrap().push(body.to_vec());
    Json(json!({"id":"test-media"}))
}
async fn mock_send(
    State(mock): State<Mock>,
    Json(value): Json<Value>,
) -> (StatusCode, [(&'static str, &'static str); 1], Json<Value>) {
    mock.messages.lock().unwrap().push(value);
    if mock.reject_next.swap(false, Ordering::SeqCst) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [("retry-after", "600")],
            Json(json!({"error":{"message":"Rate limited","code":130429}})),
        );
    }
    if mock.missing_id.load(Ordering::SeqCst) {
        return (
            StatusCode::OK,
            [("retry-after", "0")],
            Json(json!({"messages":[]})),
        );
    }
    let id = mock.messages.lock().unwrap().len();
    (
        StatusCode::OK,
        [("retry-after", "0")],
        Json(json!({"messages":[{"id":format!("wamid.test.{id}")}]})),
    )
}
async fn mock_server() -> (String, Mock) {
    let mock = Mock::default();
    let app = Router::new()
        .route("/forms/chromium/convert/html", post(mock_renderer))
        .route("/media", post(mock_upload))
        .route("/messages", post(mock_send))
        .with_state(mock.clone());
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", socket.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(socket, app).await.unwrap();
    });
    (url, mock)
}
fn prepare(kind: &str) -> PrepareInput {
    PrepareInput {
        kind: kind.into(),
        request_id: Uuid::new_v4(),
        resend_of: None,
    }
}
fn send(draft: &Notification) -> SendInput {
    SendInput {
        preview_version: draft.preview_version,
        selected_mobiles: draft
            .recipients
            .iter()
            .filter(|r| r.selected)
            .map(|r| r.normalized_mobile.clone())
            .collect(),
    }
}

#[sqlx::test]
async fn cancellation_invalidates_an_approved_invoice_preview(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    crate::features::returns::service::cancel_order(
        &state,
        orders[0],
        serde_json::from_value(json!({
            "requestId": Uuid::new_v4(), "reason": "Customer cancelled"
        }))
        .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert!(matches!(
        service::approve(&state, draft.id, send(&draft), "staff", true).await,
        Err(AppError::Conflict(_))
    ));
    assert!(mock.messages.lock().unwrap().is_empty());
}

#[sqlx::test]
async fn all_customers_default_to_unique_mobiles_and_nothing_sends_before_approval(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 2, false).await;
    let shared:Uuid=sqlx::query_scalar("INSERT INTO customers(name,mobile_no) VALUES('Shared Customer','+973 3311 2233') RETURNING id").fetch_one(&pool).await.unwrap();
    let measurement: Uuid =
        sqlx::query_scalar("INSERT INTO measurements(customer_id) VALUES($1) RETURNING id")
            .bind(shared)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE orders SET measurement_id=$2 WHERE id=$1")
        .bind(orders[1])
        .bind(measurement)
        .execute(&pool)
        .await
        .unwrap();
    let buyer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Retail Buyer','33991122') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE invoices SET customer_id=$2 WHERE id=$1")
        .bind(invoice)
        .bind(buyer)
        .execute(&pool)
        .await
        .unwrap();
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    assert_eq!(draft.recipients.len(), 2);
    assert!(draft
        .recipients
        .iter()
        .all(|r| r.selected && r.status == "draft"));
    assert_eq!(draft.recipients[0].customers.as_array().unwrap().len(), 2);
    assert_eq!(mock.renders.load(Ordering::SeqCst), 1);
    assert_eq!(
        service::document(&state, invoice).await.unwrap(),
        draft.artifact_id.unwrap()
    );
    assert_eq!(
        repository::artifact_metadata(&pool, draft.artifact_id.unwrap())
            .await
            .unwrap()
            .filename,
        "INV-1.pdf"
    );
    assert!(mock.uploads.lock().unwrap().is_empty());
    assert!(mock.messages.lock().unwrap().is_empty());
    let duplicate=sqlx::query("INSERT INTO notification_recipients(notification_id,normalized_mobile,customers) VALUES($1,$2,'[]')").bind(draft.id).bind(&draft.recipients[0].normalized_mobile).execute(&pool).await;
    assert!(duplicate.is_err());
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    let (a, b) = tokio::join!(worker::tick(&state), worker::tick(&state));
    a.unwrap();
    b.unwrap();
    worker::tick(&state).await.unwrap();
    let final_state = service::get(&state, draft.id).await.unwrap();
    assert!(final_state
        .recipients
        .iter()
        .all(|r| r.status == "accepted"));
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    let pdf: Vec<u8> = sqlx::query_scalar("SELECT content FROM document_artifacts WHERE id=$1")
        .bind(draft.artifact_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(mock
        .uploads
        .lock()
        .unwrap()
        .iter()
        .all(|upload| upload.windows(pdf.len()).any(|part| part == pdf)));
    assert_eq!(mock.renders.load(Ordering::SeqCst), 1);
}

#[sqlx::test]
async fn selection_changes_version_and_stale_content_cannot_be_approved(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    let selected = service::approve(
        &state,
        draft.id,
        SendInput {
            preview_version: draft.preview_version,
            selected_mobiles: vec![],
        },
        "staff",
        false,
    )
    .await
    .unwrap();
    assert_ne!(draft.preview_version, selected.preview_version);
    assert!(
        service::approve(&state, draft.id, send(&draft), "staff", true)
            .await
            .is_err()
    );
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,5,'cash')")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service::approve(&state, draft.id, send(&selected), "staff", true).await,
        Err(AppError::Conflict(_))
    ));
    assert!(mock.messages.lock().unwrap().is_empty());
    let refreshed = service::prepare(&state, invoice, prepare("invoice_updated"), "staff")
        .await
        .unwrap();
    assert_ne!(draft.artifact_id, refreshed.artifact_id);
    assert_ne!(draft.snapshot.body, refreshed.snapshot.body);
}

#[sqlx::test]
async fn explicit_resends_have_new_identities_and_do_not_reuse_old_invoice_content(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    sqlx::query("UPDATE invoices SET total_price=120 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let request = Uuid::new_v4();
    let resend = service::prepare(
        &state,
        invoice,
        PrepareInput {
            kind: "manual_resend".into(),
            request_id: request,
            resend_of: Some(draft.id),
        },
        "staff",
    )
    .await
    .unwrap();
    let same = service::prepare(
        &state,
        invoice,
        PrepareInput {
            kind: "manual_resend".into(),
            request_id: request,
            resend_of: Some(draft.id),
        },
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(resend.id, same.id);
    assert_ne!(resend.id, draft.id);
    assert_ne!(resend.artifact_id, draft.artifact_id);
    let another = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    assert_ne!(another.id, resend.id);
    assert_eq!(another.artifact_id, resend.artifact_id);
}

#[sqlx::test]
async fn a_known_rate_limit_retries_but_an_unknown_submission_never_does(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    mock.reject_next.store(true, Ordering::SeqCst);
    worker::tick(&state).await.unwrap();
    assert_eq!(
        service::get(&state, draft.id).await.unwrap().recipients[0].status,
        "queued"
    );
    let delay: f64 = sqlx::query_scalar("SELECT extract(epoch FROM next_attempt_at-now())::float8 FROM notification_recipients WHERE notification_id=$1")
        .bind(draft.id).fetch_one(&pool).await.unwrap();
    assert!(delay > 590., "Retry-After must postpone the next attempt");
    sqlx::query(
        "UPDATE notification_recipients SET next_attempt_at=now() WHERE notification_id=$1",
    )
    .bind(draft.id)
    .execute(&pool)
    .await
    .unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(
        service::get(&state, draft.id).await.unwrap().recipients[0].status,
        "accepted"
    );
    let resend = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    service::approve(&state, resend.id, send(&resend), "staff", true)
        .await
        .unwrap();
    mock.missing_id.store(true, Ordering::SeqCst);
    worker::tick(&state).await.unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(
        service::get(&state, resend.id).await.unwrap().recipients[0].status,
        "uncertain"
    );
    assert_eq!(mock.messages.lock().unwrap().len(), 3);
}

#[sqlx::test]
async fn webhooks_arriving_before_message_id_persistence_are_retained_and_order_independent(
    pool: PgPool,
) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    let event = |status: &str| {
        serde_json::to_vec(&json!({"entry":[{"changes":[{"value":{"statuses":[{"id":"wamid.test.1","status":status}]}}]}]})).unwrap()
    };
    worker::receive_webhook(&pool, &event("delivered"))
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(
        service::get(&state, draft.id).await.unwrap().recipients[0].status,
        "delivered"
    );
    worker::receive_webhook(&pool, &event("delivered"))
        .await
        .unwrap();
    worker::receive_webhook(&pool, &event("sent"))
        .await
        .unwrap();
    assert_eq!(
        service::get(&state, draft.id).await.unwrap().recipients[0].status,
        "delivered"
    );
}

#[sqlx::test]
async fn reopened_ready_orders_and_opted_out_destinations_are_not_sent(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    crate::features::orders::readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_ready"), "staff")
        .await
        .unwrap();
    assert!(draft.artifact_id.is_none());
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    crate::features::orders::readiness::reopen(&pool, orders[0], "staff", "Alteration needed")
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(
        service::get(&state, draft.id).await.unwrap().recipients[0].status,
        "cancelled"
    );
    sqlx::query("UPDATE customers SET whatsapp_notifications_enabled=false")
        .execute(&pool)
        .await
        .unwrap();
    let updated = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    assert!(updated.recipients.is_empty());
    assert_eq!(updated.snapshot.exclusions.len(), 1);
}

#[sqlx::test]
#[ignore = "requires the pinned Gotenberg test service"]
async fn real_chromium_renders_the_bilingual_multipage_invoice(pool: PgPool) {
    let url = std::env::var("DOCUMENT_RENDERER_TEST_URL")
        .expect("Set DOCUMENT_RENDERER_TEST_URL to the dedicated test renderer");
    let (invoice, _, _, _) = test_support::invoice(&pool, 30, false).await;
    sqlx::query("UPDATE customers SET name='أحمد المنصوري' WHERE mobile_no='33112233'")
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state(pool.clone(), Some(url), None).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    let bytes: Vec<u8> = sqlx::query_scalar("SELECT content FROM document_artifacts WHERE id=$1")
        .bind(draft.artifact_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    assert!(bytes.len() > 20_000);
    assert_eq!(draft.recipients.len(), 1);
    if let Ok(path) = std::env::var("DOCUMENT_RENDERER_TEST_OUTPUT") {
        std::fs::write(path, &bytes).unwrap();
    }
    assert_eq!(service::get(&state, draft.id).await.unwrap().state, "draft");
}

#[sqlx::test]
async fn stale_queues_cancel_all_unstarted_destinations_and_cleanup_retains_history(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let buyer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Buyer','33991122') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE invoices SET customer_id=$2 WHERE id=$1")
        .bind(invoice)
        .bind(buyer)
        .execute(&pool)
        .await
        .unwrap();
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, draft.id, send(&draft), "staff", true)
        .await
        .unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,5,'cash')")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    let stale = service::get(&state, draft.id).await.unwrap();
    assert_eq!(stale.state, "stale");
    assert_eq!(stale.recipients.len(), 2);
    assert!(stale.recipients.iter().all(|r| r.status == "cancelled"));
    assert!(matches!(
        service::prepare(&state, invoice, prepare("invoice_created"), "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(mock.messages.lock().unwrap().is_empty());
    sqlx::query("UPDATE document_artifacts SET created_at=now()-interval '100 days'")
        .execute(&pool)
        .await
        .unwrap();
    let orphan: Uuid = sqlx::query_scalar("INSERT INTO document_artifacts(invoice_id,source_hash,filename,sha256,byte_length,content,created_at) VALUES($1,'orphan','old.pdf','hash',5,'bytes',now()-interval '100 days') RETURNING id").bind(invoice).fetch_one(&pool).await.unwrap();
    let abandoned = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    sqlx::query("UPDATE notifications SET created_at=now()-interval '100 days' WHERE id=$1")
        .bind(abandoned.id)
        .execute(&pool)
        .await
        .unwrap();
    repository::cleanup(&pool, state.notifications())
        .await
        .unwrap();
    assert!(
        repository::artifact_metadata(&pool, draft.artifact_id.unwrap())
            .await
            .is_ok()
    );
    assert!(repository::artifact_metadata(&pool, orphan).await.is_err());
    assert!(matches!(
        service::get(&state, abandoned.id).await,
        Err(AppError::NotFound(_))
    ));
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, draft.id);
    assert_eq!(history[0].cancelled_count, 2);
}

#[sqlx::test]
async fn private_routes_require_staff_auth_and_webhooks_require_meta_auth(pool: PgPool) {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let state = test_support::state(pool.clone(), None, None).await;
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/api", socket.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(socket, crate::app::router(state))
            .await
            .unwrap();
    });
    let client = reqwest::Client::new();
    let id = Uuid::new_v4();
    for path in [
        format!("/documents/{id}/content"),
        format!("/notifications/{id}"),
        format!("/notifications/{id}/sends"),
        format!("/invoices/{id}/notifications"),
    ] {
        assert_eq!(
            client
                .get(format!("{url}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        client
            .delete(format!("{url}/notifications/{id}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(format!("{url}/notifications/{id}/send"))
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(format!("{url}/orders/{id}/ready"))
            .json(&json!({"confirmedAtPickupBranch":true}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let body = b"{\"entry\":[]}";
    assert_eq!(
        client
            .post(format!("{url}/webhooks/whatsapp"))
            .body(body.to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(b"test-webhook-secret").unwrap();
    mac.update(body);
    let signature = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
    for _ in 0..2 {
        assert_eq!(
            client
                .post(format!("{url}/webhooks/whatsapp"))
                .header("x-hub-signature-256", &signature)
                .body(body.to_vec())
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM whatsapp_webhook_events")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(client.get(format!("{url}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge")).send().await.unwrap().text().await.unwrap(), "challenge");
    for (mode, token) in [
        ("subscribe", "test-verify-tokeN"),
        ("subscribe", ""),
        ("invalid", "test-verify-token"),
    ] {
        assert_eq!(
            client
                .get(format!("{url}/webhooks/whatsapp"))
                .query(&[
                    ("hub.mode", mode),
                    ("hub.verify_token", token),
                    ("hub.challenge", "challenge")
                ])
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
}

#[sqlx::test]
async fn fresh_migrations_support_collection_readiness_and_customer_defaults(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 2, false).await;
    sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,30,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let statuses: Vec<String> =
        sqlx::query_scalar("SELECT status FROM orders WHERE invoice_id=$1 ORDER BY order_number")
            .bind(invoice)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(statuses, vec!["collected", "pending"]);
    assert!(sqlx::query_scalar::<_, bool>(
        "SELECT bool_and(whatsapp_notifications_enabled) FROM customers"
    )
    .fetch_one(&pool)
    .await
    .unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, f64>(
            "SELECT sum(amount)::float8 FROM invoice_payments WHERE invoice_id=$1"
        )
        .bind(invoice)
        .fetch_one(&pool)
        .await
        .unwrap(),
        30.
    );
    let readiness: (String,i64,i64) = sqlx::query_as("SELECT readiness_status,ready_order_count,collected_order_count FROM invoice_readiness WHERE invoice_id=$1").bind(invoice).fetch_one(&pool).await.unwrap();
    assert_eq!(readiness, ("in_progress".into(), 0, 1));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM notifications")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test]
async fn catalog_changes_invalidate_previews_but_keep_the_original_pdf(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("INSERT INTO design_options(category,slug,label) VALUES('thob_type','notification-test','First design label')").execute(&pool).await.unwrap();
    sqlx::query("UPDATE orders SET thobe_type='notification-test' WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let before = service::source(&state, invoice, "invoice_created")
        .await
        .unwrap();
    assert!(before.html.contains("First design label"));
    let draft = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    let original = repository::artifact_content(&pool, draft.artifact_id.unwrap())
        .await
        .unwrap();
    sqlx::query("UPDATE design_options SET label='Updated design label' WHERE category='thob_type' AND slug='notification-test'").execute(&pool).await.unwrap();
    let after = service::source(&state, invoice, "invoice_created")
        .await
        .unwrap();
    assert!(after.html.contains("Updated design label"));
    assert_eq!(before.snapshot.revision, after.snapshot.revision);
    assert_ne!(before.snapshot.source_hash, after.snapshot.source_hash);
    assert!(matches!(
        service::approve(&state, draft.id, send(&draft), "staff", true).await,
        Err(AppError::Conflict(_))
    ));
    let refreshed = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    assert_ne!(draft.artifact_id, refreshed.artifact_id);
    assert_eq!(
        repository::artifact_content(&pool, draft.artifact_id.unwrap())
            .await
            .unwrap(),
        original
    );
}

#[sqlx::test]
async fn previews_are_disposable_and_only_send_creates_history(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let input = prepare("manual_resend");
    let request_id = input.request_id;
    let draft = service::prepare(&state, invoice, input, "staff")
        .await
        .unwrap();
    let refreshed = service::prepare(
        &state,
        invoice,
        PrepareInput {
            kind: "manual_resend".into(),
            request_id,
            resend_of: None,
        },
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(draft.id, refreshed.id);
    let mut input = send(&draft);
    input.selected_mobiles.clear();
    service::approve(&state, draft.id, input, "staff", false)
        .await
        .unwrap();
    assert!(repository::history(&pool, invoice)
        .await
        .unwrap()
        .is_empty());
    assert!(matches!(
        service::resend(&state, draft.id, Uuid::new_v4(), "staff").await,
        Err(AppError::BadRequest(_))
    ));
    service::discard_preview(&state, draft.id).await.unwrap();
    service::discard_preview(&state, draft.id).await.unwrap();
    assert!(matches!(
        service::get(&state, draft.id).await,
        Err(AppError::NotFound(_))
    ));
    assert!(repository::recipients(&pool, draft.id)
        .await
        .unwrap()
        .is_empty());
    let reopened = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    assert_ne!(draft.id, reopened.id);
    assert_eq!(draft.artifact_id, reopened.artifact_id);
    assert!(reopened.recipients.iter().all(|r| r.selected));
    assert_eq!(mock.renders.load(Ordering::SeqCst), 1);
    assert!(repository::history(&pool, invoice)
        .await
        .unwrap()
        .is_empty());
    service::approve(&state, reopened.id, send(&reopened), "staff", true)
        .await
        .unwrap();
    service::approve(&state, reopened.id, send(&reopened), "staff", true)
        .await
        .unwrap();
    service::discard_preview(&state, reopened.id).await.unwrap();
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, reopened.id);
    assert_eq!(history[0].queued_count, 1);
    worker::tick(&state).await.unwrap();
    service::discard_preview(&state, reopened.id).await.unwrap();
    assert_eq!(
        repository::history(&pool, invoice).await.unwrap()[0].accepted_count,
        1
    );
    let attempts: i64 = sqlx::query_scalar("SELECT count(*) FROM notification_attempts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(attempts, 1);
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn cleanup_removes_only_unapproved_previews_and_unused_pdfs(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let approved = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, approved.id, send(&approved), "staff", true)
        .await
        .unwrap();
    service::cancel(&state, approved.id).await.unwrap();
    let live = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    let expired = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    let stale = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    let cancelled = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    service::cancel(&state, cancelled.id).await.unwrap();
    sqlx::query("UPDATE notifications SET state='stale' WHERE id=$1")
        .bind(stale.id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE notifications SET created_at=now()-interval '100 days' WHERE id IN ($1,$2)",
    )
    .bind(approved.id)
    .bind(expired.id)
    .execute(&pool)
    .await
    .unwrap();
    // An edited invoice has a different PDF; once its abandoned preview is removed,
    // that PDF can expire without removing the earlier approved attachment.
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,5,'cash')")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let edited = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
        .await
        .unwrap();
    assert_ne!(approved.artifact_id, edited.artifact_id);
    service::discard_preview(&state, edited.id).await.unwrap();
    sqlx::query("UPDATE document_artifacts SET created_at=now()-interval '100 days'")
        .execute(&pool)
        .await
        .unwrap();
    repository::cleanup(&pool, state.notifications())
        .await
        .unwrap();
    for id in [expired.id, stale.id, cancelled.id, edited.id] {
        assert!(matches!(
            service::get(&state, id).await,
            Err(AppError::NotFound(_))
        ));
        assert!(repository::recipients(&pool, id).await.unwrap().is_empty());
    }
    assert!(service::get(&state, live.id).await.is_ok());
    assert!(
        repository::artifact_metadata(&pool, approved.artifact_id.unwrap())
            .await
            .is_ok()
    );
    assert!(matches!(
        repository::artifact_metadata(&pool, edited.artifact_id.unwrap()).await,
        Err(AppError::NotFound(_))
    ));
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, approved.id);
    assert_eq!(history[0].state, "cancelled");
    assert_eq!(history[0].cancelled_count, 1);
}

#[sqlx::test]
async fn closing_a_preview_during_approval_never_deletes_an_approved_send(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    for _ in 0..5 {
        let draft = service::prepare(&state, invoice, prepare("manual_resend"), "staff")
            .await
            .unwrap();
        let (approved, discarded) = tokio::join!(
            service::approve(&state, draft.id, send(&draft), "staff", true),
            service::discard_preview(&state, draft.id),
        );
        discarded.unwrap();
        match approved {
            Ok(_) => {
                assert_eq!(
                    service::get(&state, draft.id).await.unwrap().state,
                    "approved"
                );
                assert!(repository::history(&pool, invoice)
                    .await
                    .unwrap()
                    .iter()
                    .any(|row| row.id == draft.id));
            }
            Err(AppError::Conflict(_) | AppError::NotFound(_)) => {
                assert!(matches!(
                    service::get(&state, draft.id).await,
                    Err(AppError::NotFound(_))
                ));
            }
            Err(error) => panic!("unexpected approval error: {error:?}"),
        }
    }
}

#[sqlx::test]
async fn recent_history_keeps_both_latest_notification_types_and_uses_approval_time(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, _) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let original = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, original.id, send(&original), "staff", true)
        .await
        .unwrap();
    sqlx::query("UPDATE notifications SET approved_at=now()-interval '200 days' WHERE id=$1")
        .bind(original.id)
        .execute(&pool)
        .await
        .unwrap();
    let pickup: Uuid = sqlx::query_scalar(
        "INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,state,snapshot,created_by,approved_by,approved_at)
         SELECT invoice_id,'invoice_ready','old-ready',source_hash,preview_version,'approved',snapshot,'staff','staff',now()-interval '100 days'
         FROM notifications WHERE id=$1 RETURNING id"
    ).bind(original.id).fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,state,snapshot,created_by,created_at,approved_by,approved_at)
         SELECT invoice_id,'manual_resend','history-'||item,source_hash||item,preview_version,'approved',snapshot,'staff',now()-interval '300 days','staff',now()-item*interval '1 minute'
         FROM notifications CROSS JOIN generate_series(1,101) item WHERE id=$1"
    ).bind(original.id).execute(&pool).await.unwrap();
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 101);
    assert_eq!(history[0].kind, "manual_resend");
    assert_eq!(history.last().unwrap().id, pickup);
    assert!(history[0].created_at > history.last().unwrap().created_at);
    assert!(!history.iter().any(|row| row.id == original.id));
}

#[sqlx::test]
async fn resends_update_one_version_entry_and_reject_older_links(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let original = service::prepare(&state, invoice, prepare("invoice_created"), "staff")
        .await
        .unwrap();
    service::approve(&state, original.id, send(&original), "staff", true)
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    let resent = service::resend(&state, original.id, Uuid::new_v4(), "staff")
        .await
        .unwrap();
    assert!(repository::history(&pool, invoice).await.unwrap()[0].send_count == 1);
    assert_eq!(resent.artifact_id, original.artifact_id);
    service::approve(&state, resent.id, send(&resent), "staff", true)
        .await
        .unwrap();
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, resent.id);
    assert_eq!(history[0].send_count, 2);
    assert_eq!(history[0].kind, "invoice_created");
    assert_eq!(history[0].queued_count, 1);
    let sends = repository::sends(&pool, resent.id).await.unwrap();
    assert_eq!(sends.len(), 2);
    assert_eq!(sends[0].id, resent.id);
    assert_eq!(sends[1].id, original.id);
    assert_eq!(sends[1].accepted_count, 1);
    assert_eq!(
        repository::recipients(&pool, original.id).await.unwrap()[0].status,
        "accepted"
    );
    assert!(matches!(
        service::resend(&state, original.id, Uuid::new_v4(), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let next = service::resend(&state, resent.id, Uuid::new_v4(), "staff")
        .await
        .unwrap();
    let competing = service::resend(&state, resent.id, Uuid::new_v4(), "other-staff")
        .await
        .unwrap();
    service::approve(&state, next.id, send(&next), "staff", true)
        .await
        .unwrap();
    assert!(matches!(
        service::approve(&state, competing.id, send(&competing), "other-staff", true).await,
        Err(AppError::Conflict(_))
    ));
    service::discard_preview(&state, competing.id)
        .await
        .unwrap();
    assert_eq!(
        repository::history(&pool, invoice).await.unwrap()[0].send_count,
        3
    );
    sqlx::query("UPDATE invoices SET total_price=120 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let updated = service::prepare(&state, invoice, prepare("invoice_updated"), "staff")
        .await
        .unwrap();
    service::approve(&state, updated.id, send(&updated), "staff", true)
        .await
        .unwrap();
    let history = repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].id, updated.id);
    assert_eq!(history[0].send_count, 1);
    assert_eq!(history[1].send_count, 3);
    assert!(matches!(
        service::resend(&state, next.id, Uuid::new_v4(), "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(mock.renders.load(Ordering::SeqCst), 2);
}
