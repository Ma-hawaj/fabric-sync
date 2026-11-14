use super::{
    delivery, image, repository, service,
    types::{CreateGiftCardInput, UpdateGiftCardInput},
};
use crate::{
    error::AppError,
    features::{invoices, notifications::worker},
    test_support,
};
use axum::{body::Bytes, extract::State, http::StatusCode, routing::post, Json, Router};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Mock {
    messages: Arc<Mutex<Vec<Value>>>,
    uploads: Arc<Mutex<Vec<Vec<u8>>>>,
    response: Arc<AtomicUsize>,
}

async fn mock_server() -> (String, Mock) {
    async fn upload(State(mock): State<Mock>, body: Bytes) -> (StatusCode, Json<Value>) {
        mock.uploads.lock().unwrap().push(body.to_vec());
        if mock.response.load(Ordering::SeqCst) == 3 {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":{"message":"Upload unavailable"}})),
            );
        }
        (StatusCode::OK, Json(json!({"id":"gift-media-test"})))
    }
    async fn send(State(mock): State<Mock>, Json(value): Json<Value>) -> (StatusCode, Json<Value>) {
        let count = {
            let mut messages = mock.messages.lock().unwrap();
            messages.push(value);
            messages.len()
        };
        match mock.response.load(Ordering::SeqCst) {
            1 => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":{"message":"Rate limited"}})),
            ),
            2 => (StatusCode::OK, Json(json!({"messages":[]}))),
            _ => (
                StatusCode::OK,
                Json(
                    json!({"messages":[{"id":if count == 1 { "wamid.gift-test".to_string() } else { format!("wamid.gift-test.{count}") }}]}),
                ),
            ),
        }
    }
    let mock = Mock::default();
    let app = Router::new()
        .route("/messages", post(send))
        .route("/media", post(upload))
        .route(
            "/forms/chromium/convert/html",
            post(|| async {
                (
                    [("content-type", "application/pdf")],
                    b"%PDF-1.4\nmock invoice\n%%EOF".as_slice(),
                )
            }),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, mock)
}

fn input() -> CreateGiftCardInput {
    serde_json::from_value(json!({"amount":50,"boughtFor":"  Gift Recipient  ","recipientPhone":"33112233","code":"USER-SUPPLIED"})).unwrap()
}

#[sqlx::test]
async fn legacy_gift_card_preview_creates_a_manual_parent_only_on_approval(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "staff")
        .await
        .unwrap();
    sqlx::query("DELETE FROM notification_requests WHERE gift_card_id=$1")
        .bind(card.id)
        .execute(&pool)
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    assert!(
        crate::features::notifications::repository::gift_card_request_id(
            &mut *pool.acquire().await.unwrap(),
            card.id
        )
        .await
        .unwrap()
        .is_none()
    );
    let command = Uuid::new_v4();
    delivery::approve(&state, card.id, send(&preview, command), "staff")
        .await
        .unwrap();
    let parent = crate::features::notifications::repository::gift_card_request_id(
        &mut *pool.acquire().await.unwrap(),
        card.id,
    )
    .await
    .unwrap()
    .unwrap();
    let stored: (Uuid, String) = sqlx::query_as("SELECT d.notification_request_id,r.origin FROM notifications d JOIN notification_requests r ON r.id=d.notification_request_id WHERE d.command_id=$1")
        .bind(command).fetch_one(&pool).await.unwrap();
    assert_eq!(stored, (parent, "manual".into()));
    sqlx::query("UPDATE notification_recipients SET status='failed' WHERE notification_id=(SELECT id FROM notifications WHERE command_id=$1)")
        .bind(command)
        .execute(&pool)
        .await
        .unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    let parents: Vec<Uuid> = sqlx::query_scalar(
        "SELECT notification_request_id FROM notifications WHERE gift_card_id=$1",
    )
    .bind(card.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(parents, vec![parent, parent]);

    crate::features::notifications::repository::request_gift_card(
        &mut *pool.acquire().await.unwrap(),
        card.id,
    )
    .await
    .unwrap();
    let newer = crate::features::notifications::repository::gift_card_request_id(
        &mut *pool.acquire().await.unwrap(),
        card.id,
    )
    .await
    .unwrap()
    .unwrap();
    assert_ne!(parent, newer);
    worker::tick(&state).await.unwrap();
    let cancelled: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications n JOIN notification_recipients r ON r.notification_id=n.id WHERE n.gift_card_id=$1 AND r.status='cancelled'",
    )
    .bind(card.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cancelled, 1);
    assert!(mock.messages.lock().unwrap().is_empty());
}
fn send(preview: &delivery::Preview, request_id: Uuid) -> delivery::SendInput {
    delivery::SendInput {
        source_hash: preview.source_hash.clone(),
        request_id,
    }
}

/// Exercise the same compact-code normalization through lookup and transactional spending.
#[sqlx::test]
async fn short_code_lookup_and_redemption_accept_compact_input(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let payload = card.code.strip_prefix("GC-").unwrap().replace('-', "");
    let spaced = payload
        .as_bytes()
        .chunks(4)
        .map(|s| std::str::from_utf8(s).unwrap())
        .collect::<Vec<_>>()
        .join(" ");
    for alias in [
        payload.clone(),
        spaced,
        payload.to_lowercase(),
        card.code.replace('-', ""),
    ] {
        assert_eq!(
            service::get_gift_card_by_code(&state, &alias)
                .await
                .unwrap()
                .id,
            card.id
        );
    }
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        service::redeem(
            &mut tx,
            &payload.to_lowercase(),
            10.0,
            chrono::Utc::now().date_naive()
        )
        .await
        .unwrap(),
        card.id
    );
    tx.commit().await.unwrap();
    assert_eq!(
        service::get_gift_card_by_code(&state, &card.code)
            .await
            .unwrap()
            .balance,
        40.0
    );
}

/// Force collisions in a live transaction and verify that retries retain the issuer.
#[sqlx::test]
async fn generated_code_collisions_retry_without_aborting_the_transaction(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let existing = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let fresh = loop {
        let code = service::generate_code();
        if code != existing.code {
            break code;
        }
    };
    let mut attempts = 0;
    let mut tx = pool.begin().await.unwrap();
    let (id, code) =
        service::issue_with_generator(&mut tx, &input(), "BH", Some("retry-issuer"), || {
            attempts += 1;
            if attempts == 1 {
                existing.code.clone()
            } else {
                fresh.clone()
            }
        })
        .await
        .unwrap();
    assert_eq!(attempts, 2);
    assert_eq!(code, fresh);
    tx.commit().await.unwrap();
    assert_ne!(id, existing.id);
    assert_eq!(
        service::get_gift_card_by_code(&state, &code)
            .await
            .unwrap()
            .issued_by
            .as_deref(),
        Some("retry-issuer")
    );
    assert_eq!(
        service::get_gift_card_by_code(&state, &existing.code)
            .await
            .unwrap()
            .balance,
        50.0
    );
}

/// Exhaust the retry budget and prove the surrounding transaction remains usable.
#[sqlx::test]
async fn repeated_collisions_stop_without_poisoning_the_transaction(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let existing = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let mut attempts = 0;
    let mut tx = pool.begin().await.unwrap();
    let error =
        service::issue_with_generator(&mut tx, &input(), "BH", Some("retry-issuer"), || {
            attempts += 1;
            existing.code.clone()
        })
        .await
        .unwrap_err();
    assert!(matches!(error, AppError::Conflict(_)));
    assert_eq!(attempts, 8);
    let usable: i32 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(usable, 1);
    tx.rollback().await.unwrap();
}

/// Reject malformed codes consistently without altering an existing card's balance.
#[sqlx::test]
async fn invalid_code_formats_are_not_looked_up_or_redeemed(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    for code in ["GC-ABC123", "GC-0123456789ABCDEF0123456789ABCDEF"] {
        assert!(matches!(
            service::get_gift_card_by_code(&state, code).await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            service::redeem(&mut tx, code, 10.0, chrono::Utc::now().date_naive()).await,
            Err(AppError::BadRequest(_))
        ));
    }
    tx.commit().await.unwrap();
    assert_eq!(
        service::get_gift_card_by_code(&state, &card.code)
            .await
            .unwrap()
            .balance,
        card.balance
    );
}

/// Keep the buyer relationship independent of recipient details on generated cards.
#[sqlx::test]
async fn codes_are_generated_and_recipient_is_separate_from_buyer(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let first = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let second = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    assert!(first.code.starts_with("GC-"));
    assert_eq!(first.code.len(), 17);
    assert_ne!(first.code, "USER-SUPPLIED");
    assert_ne!(first.code, second.code);
    assert_eq!(first.recipient_phone.as_deref(), Some("+97333112233"));
    assert_eq!(first.bought_for.as_deref(), Some("Gift Recipient"));
    assert_eq!(first.customer_id, None);
    assert_eq!(
        service::get_gift_card_by_code(&state, &first.code.to_lowercase())
            .await
            .unwrap()
            .id,
        first.id
    );
    for phone in ["", "123", "not a number"] {
        let mut invalid = input();
        invalid.recipient_phone = phone.into();
        assert!(matches!(
            service::create_gift_card(&state, invalid, "test-staff").await,
            Err(AppError::BadRequest(_))
        ));
    }
}

/// Verify preview/approval boundaries and idempotent delivery using local provider mocks.
#[sqlx::test]
async fn preview_is_read_only_and_approval_is_idempotent_with_delivery_callbacks(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let parent = crate::features::notifications::repository::gift_card_request_id(
        &mut *pool.acquire().await.unwrap(),
        card.id,
    )
    .await
    .unwrap()
    .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    assert!(preview.body.contains(&card.code));
    assert!(preview.body.contains("Gift Recipient"));
    assert!(preview.body.contains("50.000 BHD"));
    assert!(preview
        .image_data_url
        .starts_with("data:image/png;base64,iVBOR"));
    let preview_png = preview.image.png.clone();
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert!(mock.uploads.lock().unwrap().is_empty());
    let request = Uuid::new_v4();
    delivery::approve(&state, card.id, send(&preview, request), "test-staff")
        .await
        .unwrap();
    let linked: Uuid =
        sqlx::query_scalar("SELECT notification_request_id FROM notifications WHERE command_id=$1")
            .bind(request)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(linked, parent);
    delivery::approve(&state, card.id, send(&preview, request), "test-staff")
        .await
        .unwrap();
    assert!(matches!(
        delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let early = json!({"entry":[{"changes":[{"value":{"statuses":[{"id":"wamid.gift-test","status":"delivered"}]}}]}]}).to_string();
    worker::receive_webhook(&pool, early.as_bytes())
        .await
        .unwrap();
    let (a, b) = tokio::join!(worker::tick(&state), worker::tick(&state));
    a.unwrap();
    b.unwrap();
    let messages = mock.messages.lock().unwrap().clone();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["to"], "97333112233");
    assert_eq!(messages[0]["template"]["name"], "gift_card_image_v1");
    assert_eq!(
        messages[0]["template"]["components"][0],
        json!({"type":"header","parameters":[{"type":"image","image":{"id":"gift-media-test"}}]})
    );
    assert_eq!(
        messages[0]["template"]["components"][1]["parameters"][2]["text"],
        card.code
    );
    let uploads = mock.uploads.lock().unwrap().clone();
    assert_eq!(uploads.len(), 1);
    assert!(uploads[0]
        .windows(preview_png.len())
        .any(|bytes| bytes == preview_png));
    assert!(String::from_utf8_lossy(&uploads[0]).contains("image/png"));
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT content FROM document_artifacts WHERE gift_card_id=$1")
            .bind(card.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, preview_png);
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("delivered")
    );
    for status in ["read", "delivered", "sent", "failed"] {
        let body=json!({"entry":[{"changes":[{"value":{"statuses":[{"id":"wamid.gift-test","status":status}]}}]}]}).to_string();
        worker::receive_webhook(&pool, body.as_bytes())
            .await
            .unwrap();
    }
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("read")
    );
}

#[sqlx::test]
async fn invalid_queued_phone_does_not_block_later_deliveries(pool: PgPool) {
    assert_invalid_preview_does_not_block_queue(pool, true).await;
}

#[sqlx::test]
async fn gift_cards_and_invoice_documents_share_one_worker_with_one_connection(db: PgPool) {
    use crate::features::notifications;
    let (invoice, _, _, _) = test_support::invoice(&db, 1, false).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(2))
        .connect_with((*db.connect_options()).clone())
        .await
        .unwrap();
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), Some(url.clone()), Some(url)).await;
    let card = service::create_gift_card(&state, input(), "staff")
        .await
        .unwrap();
    let invoice_preview = notifications::service::prepare(
        &state,
        invoice,
        serde_json::from_value(json!({
            "kind":"invoice_created", "requestId":Uuid::new_v4()
        }))
        .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    notifications::service::approve(
        &state,
        invoice_preview.id,
        notifications::types::SendInput {
            preview_version: invoice_preview.preview_version,
            selected_mobiles: invoice_preview
                .recipients
                .iter()
                .map(|r| r.normalized_mobile.clone())
                .collect(),
        },
        "staff",
        true,
    )
    .await
    .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    let command = Uuid::new_v4();
    delivery::approve(&state, card.id, send(&preview, command), "staff")
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    assert_eq!(mock.uploads.lock().unwrap().len(), 2);
    let messages = mock.messages.lock().unwrap().clone();
    assert_eq!(
        messages[0]["template"]["components"][0]["parameters"][0]["type"],
        "document"
    );
    assert_eq!(
        messages[1]["template"]["components"][0]["parameters"][0]["type"],
        "image"
    );
    assert_eq!(
        notifications::service::get(&state, invoice_preview.id)
            .await
            .unwrap()
            .recipients[0]
            .status,
        "accepted"
    );
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("accepted")
    );
    let attempts: i64 = sqlx::query_scalar("SELECT count(*) FROM notification_attempts WHERE finished_at IS NOT NULL AND outcome='accepted'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(attempts, 2);
    let other = service::create_gift_card(&state, input(), "staff")
        .await
        .unwrap();
    let other_preview = delivery::preview(&state, other.id).await.unwrap();
    assert!(matches!(
        delivery::approve(&state, other.id, send(&other_preview, command), "staff").await,
        Err(AppError::Conflict(_))
    ));
    pool.close().await;
}

#[sqlx::test]
async fn expired_gift_card_claims_finish_the_shared_audit_without_replaying(pool: PgPool) {
    use crate::features::notifications::repository as queue;
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "staff")
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    let (recipient, request) = queue::next_job(&pool).await.unwrap().unwrap();
    let mut tx = pool.begin().await.unwrap();
    queue::lock_target(&mut tx, request).await.unwrap();
    let mut job = queue::lock_job(&mut tx, recipient).await.unwrap().unwrap();
    job.attempt_count += 1;
    queue::start_attempt(&mut tx, &job).await.unwrap();
    tx.commit().await.unwrap();
    sqlx::query(
        "UPDATE notification_recipients SET claimed_at=now()-interval '4 minutes' WHERE id=$1",
    )
    .bind(recipient)
    .execute(&pool)
    .await
    .unwrap();
    worker::tick(&state).await.unwrap();
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert!(mock.uploads.lock().unwrap().is_empty());
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("uncertain")
    );
    let audit: (String, bool) = sqlx::query_as(
        "SELECT outcome,finished_at IS NOT NULL FROM notification_attempts WHERE recipient_id=$1",
    )
    .bind(recipient)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit, ("uncertain".into(), true));
}

#[sqlx::test]
async fn unconfigured_queued_parameter_does_not_block_later_deliveries(pool: PgPool) {
    assert_invalid_preview_does_not_block_queue(pool, false).await;
}

/// Corrupt one approved job and ensure the worker still delivers the valid queued card.
async fn assert_invalid_preview_does_not_block_queue(pool: PgPool, invalid_phone: bool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let invalid = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let valid = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    for card in [&invalid, &valid] {
        let preview = delivery::preview(&state, card.id).await.unwrap();
        delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
            .await
            .unwrap();
    }
    let (corrupt, expected_error) = if invalid_phone {
        (
            "UPDATE gift_cards SET recipient_phone='invalid' WHERE id=$1",
            "Enter a valid recipient phone number.",
        )
    } else {
        // A changed recipient value can leave an unresolved template token,
        // just like a template configuration changed after approval.
        (
            "UPDATE gift_cards SET bought_for='{{6}}' WHERE id=$1",
            "The gift card template contains an unconfigured parameter.",
        )
    };
    sqlx::query(corrupt)
        .bind(invalid.id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE notification_recipients SET next_attempt_at=now()-interval '1 minute' WHERE notification_id IN (SELECT id FROM notifications WHERE gift_card_id=$1)")
        .bind(invalid.id).execute(&pool).await.unwrap();

    worker::tick(&state).await.unwrap();
    let failed = repository::get_gift_card(&state, invalid.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(failed.delivery_status.as_deref(), Some("failed"));
    assert_eq!(failed.delivery_error.as_deref(), Some(expected_error));
    assert!(mock.uploads.lock().unwrap().is_empty());
    assert!(mock.messages.lock().unwrap().is_empty());

    worker::tick(&state).await.unwrap();
    let delivered = repository::get_gift_card(&state, valid.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delivered.delivery_status.as_deref(), Some("accepted"));
    let messages = mock.messages.lock().unwrap();
    assert_eq!(messages.len(), 1);
    assert!(messages[0].to_string().contains(&valid.code));
    assert_eq!(mock.uploads.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn changed_recipient_invalidates_preview_and_cancels_queued_delivery(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    let changes: UpdateGiftCardInput =
        serde_json::from_value(json!({"boughtFor":"New Recipient","recipientPhone":"33991122"}))
            .unwrap();
    service::update_gift_card(&state, card.id, changes)
        .await
        .unwrap();
    assert!(matches!(
        delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let current = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&current, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    service::update_gift_card(
        &state,
        card.id,
        serde_json::from_value(json!({"isActive":false})).unwrap(),
    )
    .await
    .unwrap();
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("cancelled")
    );
}

/// Retry confirmed provider failures while preventing duplicate sends after an unknown result.
#[sqlx::test]
async fn retries_known_failures_but_never_replays_an_unknown_submission(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    mock.response.store(1, Ordering::SeqCst);
    worker::tick(&state).await.unwrap();
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("queued")
    );
    sqlx::query("UPDATE notification_recipients SET next_attempt_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    mock.response.store(2, Ordering::SeqCst);
    worker::tick(&state).await.unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    let outcomes: Vec<String> = sqlx::query_scalar(
        "SELECT outcome FROM notification_attempts ORDER BY started_at, attempt_number",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(outcomes, ["retry_scheduled", "uncertain"]);
    for upload in mock.uploads.lock().unwrap().iter() {
        assert!(upload
            .windows(preview.image.png.len())
            .any(|bytes| bytes == preview.image.png));
    }
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("uncertain")
    );
}

#[sqlx::test]
async fn image_upload_failure_retries_without_submitting_a_message(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    mock.response.store(3, Ordering::SeqCst);
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(mock.uploads.lock().unwrap().len(), 1);
    let card = repository::get_gift_card(&state, card.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(card.delivery_status.as_deref(), Some("queued"));
    assert_eq!(card.delivery_error.as_deref(), Some("Upload unavailable"));
}

#[sqlx::test]
async fn damaged_approved_image_is_never_uploaded(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    sqlx::query("UPDATE document_artifacts SET content=decode('00','hex') WHERE gift_card_id=$1")
        .bind(card.id)
        .execute(&pool)
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert!(mock.uploads.lock().unwrap().is_empty());
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("failed")
    );
    // An explicit new approval may generate a fresh image without rewriting
    // the earlier attachment or replaying its failed attempt.
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    worker::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    let artifacts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM document_artifacts WHERE gift_card_id=$1")
            .bind(card.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(artifacts, 2);
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("accepted")
    );
}

#[sqlx::test]
async fn image_download_works_without_whatsapp_setup(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let image = image::get(&state, card.id).await.unwrap();
    assert!(image.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert_eq!(image.filename, format!("gift-card-{}.png", card.id));
    let sends: i64 = sqlx::query_scalar("SELECT count(*) FROM notifications")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sends, 0);
}

#[sqlx::test]
async fn invoice_creation_returns_cards_ready_for_individual_delivery(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let input = json!({"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[
        {"amount":50,"boughtFor":"First recipient","recipientPhone":"33112233"},
        {"amount":75,"boughtFor":"Second recipient","recipientPhone":"33998877"}
    ]});
    let invoice = invoices::service::create_invoice(
        &state,
        serde_json::from_value(input).unwrap(),
        "test-staff",
    )
    .await
    .unwrap();
    assert_eq!(invoice.gift_cards.len(), 2);
    assert_ne!(invoice.gift_cards[0].id, invoice.gift_cards[1].id);
    assert_ne!(invoice.gift_cards[0].code, invoice.gift_cards[1].code);
    let response = serde_json::to_value(&invoice).unwrap();
    assert_eq!(
        response["giftCards"][0]["id"],
        invoice.gift_cards[0].id.to_string()
    );
    assert_eq!(response["giftCards"][0]["code"], invoice.gift_cards[0].code);

    for (card, (recipient, phone, amount)) in invoice.gift_cards.iter().zip([
        ("First recipient", "+97333112233", 50.0),
        ("Second recipient", "+97333998877", 75.0),
    ]) {
        let stored = service::get_gift_card_by_code(&state, &card.code)
            .await
            .unwrap();
        assert_eq!(stored.id, card.id);
        assert_eq!(stored.balance, amount);
        let linked: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM invoice_items WHERE invoice_id=$1 AND gift_card_id=$2)",
        )
        .bind(invoice.id)
        .bind(card.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(linked);
        let preview = delivery::preview(&state, card.id).await.unwrap();
        assert_eq!(preview.bought_for.as_deref(), Some(recipient));
        assert_eq!(preview.mobile, phone);
        assert!(preview.body.contains(&card.code));
    }
    worker::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert!(mock.uploads.lock().unwrap().is_empty());

    let first = &invoice.gift_cards[0];
    let preview = delivery::preview(&state, first.id).await.unwrap();
    let request_id = Uuid::new_v4();
    for _ in 0..2 {
        delivery::approve(&state, first.id, send(&preview, request_id), "test-staff")
            .await
            .unwrap();
    }
    worker::tick(&state).await.unwrap();
    let messages = mock.messages.lock().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["to"], "97333112233");
    assert!(messages[0].to_string().contains(&first.code));
    assert_eq!(mock.uploads.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn invalid_invoice_recipient_rolls_back_all_cards_without_delivery(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let input = json!({"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[
        {"amount":50,"recipientPhone":"33112233"},
        {"amount":75,"recipientPhone":"invalid"}
    ]});
    assert!(matches!(
        invoices::service::create_invoice(
            &state,
            serde_json::from_value(input).unwrap(),
            "test-staff"
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    for table in ["invoices", "gift_cards", "notifications"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}

#[sqlx::test]
async fn invoice_sales_generate_codes_and_keep_them_on_edit_until_delivery(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let input = json!({"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":50,"recipientPhone":"33112233","boughtFor":"Gift Recipient","code":"MANUAL"}]});
    let invoice = invoices::service::create_invoice(
        &state,
        serde_json::from_value(input.clone()).unwrap(),
        "test-staff",
    )
    .await
    .unwrap();
    let edit = invoices::service::get_invoice_for_edit(&state, invoice.id)
        .await
        .unwrap();
    let code = edit.gift_cards[0].code.clone();
    assert_eq!(invoice.gift_cards.len(), 1);
    assert_eq!(invoice.gift_cards[0].code, code);
    assert_ne!(code, "MANUAL");
    assert_eq!(
        edit.gift_cards[0].recipient_phone.as_deref(),
        Some("+97333112233")
    );
    let mut changed = input.clone();
    for alias in [
        code.clone(),
        code.to_lowercase(),
        code.replace('-', ""),
        format!(" {} ", code.strip_prefix("GC-").unwrap().to_lowercase()),
    ] {
        changed["giftCards"][0]["code"] = json!(alias);
        let updated = invoices::service::update_invoice(
            &state,
            invoice.id,
            serde_json::from_value(changed.clone()).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(updated.gift_cards.len(), 1);
        assert_eq!(updated.gift_cards[0].code, code);
        let stored = service::get_gift_card_by_code(&state, &code).await.unwrap();
        assert_eq!(updated.gift_cards[0].id, stored.id);
    }
    let card = service::get_gift_card_by_code(&state, &code).await.unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    let error = invoices::service::update_invoice(
        &state,
        invoice.id,
        serde_json::from_value(changed).unwrap(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AppError::BadRequest(_)));
    assert_eq!(
        service::get_gift_card_by_code(&state, &code)
            .await
            .unwrap()
            .id,
        card.id
    );
}

/// Keep only this invoice's original card codes when rebuilding its sale lines.
#[sqlx::test]
async fn invoice_edits_generate_new_codes_for_foreign_or_invalid_submissions(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let foreign = service::create_gift_card(&state, input(), "test-staff")
        .await
        .unwrap();
    let mut sale = json!({"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[
        {"amount":50,"recipientPhone":"33112233"},
        {"amount":75,"recipientPhone":"33998877"}
    ]});
    let invoice = invoices::service::create_invoice(
        &state,
        serde_json::from_value(sale.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    sale["giftCards"][0]["code"] = json!(foreign.code.to_lowercase().replace('-', ""));
    sale["giftCards"][1]["code"] = json!("invalid");
    let updated = invoices::service::update_invoice(
        &state,
        invoice.id,
        serde_json::from_value(sale).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(updated.gift_cards.len(), 2);
    for card in updated.gift_cards {
        assert_ne!(card.code, foreign.code);
        assert_eq!(service::normalize_code(&card.code).unwrap(), card.code);
    }
    let untouched = service::get_gift_card_by_code(&state, &foreign.code)
        .await
        .unwrap();
    assert_eq!(untouched.id, foreign.id);
    assert_eq!(untouched.balance, foreign.balance);
}
