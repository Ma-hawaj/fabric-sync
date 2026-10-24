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
        mock.messages.lock().unwrap().push(value);
        match mock.response.load(Ordering::SeqCst) {
            1 => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({"error":{"message":"Rate limited"}})),
            ),
            2 => (StatusCode::OK, Json(json!({"messages":[]}))),
            _ => (
                StatusCode::OK,
                Json(json!({"messages":[{"id":"wamid.gift-test"}]})),
            ),
        }
    }
    let mock = Mock::default();
    let app = Router::new()
        .route("/messages", post(send))
        .route("/media", post(upload))
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
fn send(preview: &delivery::Preview, request_id: Uuid) -> delivery::SendInput {
    delivery::SendInput {
        source_hash: preview.source_hash.clone(),
        request_id,
    }
}

#[sqlx::test]
async fn short_code_lookup_and_redemption_accept_compact_input(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
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

#[sqlx::test]
async fn generated_code_collisions_retry_without_aborting_the_transaction(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let existing = service::create_gift_card(&state, input()).await.unwrap();
    let fresh = loop {
        let code = service::generate_code();
        if code != existing.code {
            break code;
        }
    };
    let mut attempts = 0;
    let mut tx = pool.begin().await.unwrap();
    let (id, code) = service::issue_with_generator(&mut tx, &input(), "BH", || {
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
        service::get_gift_card_by_code(&state, &existing.code)
            .await
            .unwrap()
            .balance,
        50.0
    );
}

#[sqlx::test]
async fn repeated_collisions_stop_without_poisoning_the_transaction(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let existing = service::create_gift_card(&state, input()).await.unwrap();
    let mut attempts = 0;
    let mut tx = pool.begin().await.unwrap();
    let error = service::issue_with_generator(&mut tx, &input(), "BH", || {
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

#[sqlx::test]
async fn invalid_code_formats_are_not_looked_up_or_redeemed(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
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

#[sqlx::test]
async fn codes_are_generated_and_recipient_is_separate_from_buyer(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let first = service::create_gift_card(&state, input()).await.unwrap();
    let second = service::create_gift_card(&state, input()).await.unwrap();
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
            service::create_gift_card(&state, invalid).await,
            Err(AppError::BadRequest(_))
        ));
    }
}

#[sqlx::test]
async fn preview_is_read_only_and_approval_is_idempotent_with_delivery_callbacks(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    assert!(preview.body.contains(&card.code));
    assert!(preview.body.contains("Gift Recipient"));
    assert!(preview.body.contains("50.000 BHD"));
    assert!(preview
        .image_data_url
        .starts_with("data:image/png;base64,iVBOR"));
    let preview_png = preview.image.png.clone();
    delivery::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert!(mock.uploads.lock().unwrap().is_empty());
    let request = Uuid::new_v4();
    delivery::approve(&state, card.id, send(&preview, request), "test-staff")
        .await
        .unwrap();
    delivery::approve(&state, card.id, send(&preview, request), "test-staff")
        .await
        .unwrap();
    assert!(matches!(
        delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let (a, b) = tokio::join!(delivery::tick(&state), delivery::tick(&state));
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
        sqlx::query_scalar("SELECT image_png FROM gift_card_deliveries WHERE gift_card_id=$1")
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
        Some("accepted")
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
async fn changed_recipient_invalidates_preview_and_cancels_queued_delivery(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
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
    delivery::tick(&state).await.unwrap();
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

#[sqlx::test]
async fn retries_known_failures_but_never_replays_an_unknown_submission(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    mock.response.store(1, Ordering::SeqCst);
    delivery::tick(&state).await.unwrap();
    assert_eq!(
        repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .delivery_status
            .as_deref(),
        Some("queued")
    );
    sqlx::query("UPDATE gift_card_deliveries SET available_at=now()")
        .execute(&pool)
        .await
        .unwrap();
    mock.response.store(2, Ordering::SeqCst);
    delivery::tick(&state).await.unwrap();
    delivery::tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
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
    let card = service::create_gift_card(&state, input()).await.unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    mock.response.store(3, Ordering::SeqCst);
    delivery::tick(&state).await.unwrap();
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
    let card = service::create_gift_card(&state, input()).await.unwrap();
    let preview = delivery::preview(&state, card.id).await.unwrap();
    delivery::approve(&state, card.id, send(&preview, Uuid::new_v4()), "staff")
        .await
        .unwrap();
    sqlx::query(
        "UPDATE gift_card_deliveries SET image_png=decode('00','hex') WHERE gift_card_id=$1",
    )
    .bind(card.id)
    .execute(&pool)
    .await
    .unwrap();
    delivery::tick(&state).await.unwrap();
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
}

#[sqlx::test]
async fn image_download_works_without_whatsapp_setup(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let card = service::create_gift_card(&state, input()).await.unwrap();
    let image = image::get(&state, card.id).await.unwrap();
    assert!(image.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert_eq!(image.filename, format!("gift-card-{}.png", card.id));
    let sends: i64 = sqlx::query_scalar("SELECT count(*) FROM gift_card_deliveries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sends, 0);
}

#[sqlx::test]
async fn invoice_creation_returns_cards_ready_for_individual_delivery(pool: PgPool) {
    let (url, mock) = mock_server().await;
    let state = test_support::state(pool.clone(), None, Some(url)).await;
    let input = json!({"discountUnit":"amount","giftCards":[
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
    delivery::tick(&state).await.unwrap();
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
    delivery::tick(&state).await.unwrap();
    let messages = mock.messages.lock().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["to"], "97333112233");
    assert!(messages[0].to_string().contains(&first.code));
    assert_eq!(mock.uploads.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn invalid_invoice_recipient_rolls_back_all_cards_without_delivery(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let input = json!({"discountUnit":"amount","giftCards":[
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
    for table in ["invoices", "gift_cards", "gift_card_deliveries"] {
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
    let input = json!({"discountUnit":"amount","giftCards":[{"amount":50,"recipientPhone":"33112233","boughtFor":"Gift Recipient","code":"MANUAL"}]});
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
    changed["giftCards"][0]["code"] = json!(code);
    let updated = invoices::service::update_invoice(
        &state,
        invoice.id,
        serde_json::from_value(changed.clone()).unwrap(),
    )
    .await
    .unwrap();
    let card = service::get_gift_card_by_code(&state, &code).await.unwrap();
    assert_eq!(updated.gift_cards.len(), 1);
    assert_eq!(updated.gift_cards[0].id, card.id);
    assert_eq!(updated.gift_cards[0].code, code);
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
