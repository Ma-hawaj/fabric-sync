use super::{
    delivery, repository, service,
    types::{CreateGiftCardInput, UpdateGiftCardInput},
};
use crate::{
    error::AppError,
    features::{invoices, notifications::worker},
    test_support,
};
use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
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
    response: Arc<AtomicUsize>,
}

async fn mock_server() -> (String, Mock) {
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
async fn codes_are_generated_and_recipient_is_separate_from_buyer(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let first = service::create_gift_card(&state, input()).await.unwrap();
    let second = service::create_gift_card(&state, input()).await.unwrap();
    assert!(first.code.starts_with("GC-"));
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
    delivery::tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
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
    assert_eq!(messages[0]["template"]["name"], "gift_card_v1");
    assert_eq!(
        messages[0]["template"]["components"][0]["parameters"][2]["text"],
        card.code
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
async fn invoice_sales_generate_codes_and_keep_them_on_edit_until_delivery(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let input = json!({"discountUnit":"amount","giftCards":[{"amount":50,"recipientPhone":"33112233","boughtFor":"Gift Recipient","code":"MANUAL"}]});
    let invoice =
        invoices::service::create_invoice(&state, serde_json::from_value(input.clone()).unwrap())
            .await
            .unwrap();
    let edit = invoices::service::get_invoice_for_edit(&state, invoice.id)
        .await
        .unwrap();
    let code = edit.gift_cards[0].code.clone();
    assert_ne!(code, "MANUAL");
    assert_eq!(
        edit.gift_cards[0].recipient_phone.as_deref(),
        Some("+97333112233")
    );
    let mut changed = input.clone();
    changed["giftCards"][0]["code"] = json!(code);
    invoices::service::update_invoice(
        &state,
        invoice.id,
        serde_json::from_value(changed.clone()).unwrap(),
    )
    .await
    .unwrap();
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
