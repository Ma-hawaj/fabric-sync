use super::*;
use crate::{features::notifications::handlers, test_support};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use sqlx::PgPool;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

#[derive(Clone, Default)]
struct Mock {
    messages: Arc<Mutex<Vec<Value>>>,
    response: Arc<AtomicUsize>,
}

async fn mock_server() -> (String, Mock) {
    let mock = Mock::default();
    let app = Router::new()
        .route(
            "/messages",
            post(
                |State(mock): State<Mock>, headers: HeaderMap, Json(body): Json<Value>| async move {
                    assert_eq!(headers["authorization"], "Bearer test-token");
                    mock.messages.lock().unwrap().push(body);
                    match mock.response.load(Ordering::SeqCst) {
                        1 => (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(json!({"error":{"message":"Rate limited"}})),
                        ),
                        2 => (StatusCode::OK, Json(json!({"messages":[]}))),
                        _ => {
                            let count = mock.messages.lock().unwrap().len();
                            (
                                StatusCode::OK,
                                Json(json!({"messages":[{"id":format!("wamid.reply.{count}")}]})),
                            )
                        }
                    }
                },
            ),
        )
        .with_state(mock.clone());
    let socket = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", socket.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(socket, app).await.unwrap();
    });
    (url, mock)
}

fn input(enabled: bool) -> Update {
    Update {
        enabled,
        message:
            "This number sends automated notifications. Please contact our shop at +97333112233."
                .into(),
        cooldown_hours: 24,
        max_per_minute: 10,
        button: None,
    }
}

fn event(id: &str, from: &str) -> Value {
    json!({"object":"whatsapp_business_account", "entry":[{"changes":[{"field":"messages", "value":{
        "metadata":{"phone_number_id":"test-phone", "display_phone_number":"97333000000"},
        "messages":[{"id":id,"from":from,"timestamp":Utc::now().timestamp().to_string(),"type":"text","text":{"body":"Hello"}}]
    }}]}]})
}

async fn state(pool: &PgPool) -> (AppState, Mock) {
    let (url, mock) = mock_server().await;
    (
        test_support::state(pool.clone(), None, Some(url)).await,
        mock,
    )
}

async fn status(pool: &PgPool, id: &str) -> String {
    sqlx::query_scalar("SELECT status FROM whatsapp_auto_replies WHERE inbound_message_id=$1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test]
async fn disabled_by_default_and_enabling_does_not_replay_old_webhooks(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    assert!(!settings(&state).await.unwrap().enabled);
    let body = event("wamid.disabled", "97333112233");
    worker::receive_webhook(&state, &serde_json::to_vec(&body).unwrap())
        .await
        .unwrap();
    update(&state, input(true), "manager").await.unwrap();
    // A new envelope containing the same message still cannot replay it.
    let mut replay = body.clone();
    replay["entry"][0]["time"] = json!(123);
    worker::receive_webhook(&state, &serde_json::to_vec(&replay).unwrap())
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert!(mock.messages.lock().unwrap().is_empty());
    assert_eq!(status(&pool, "wamid.disabled").await, "suppressed");
}

#[sqlx::test]
async fn concurrent_messages_and_webhook_retries_send_only_one_reply_per_cooldown(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    update(&state, input(true), "manager").await.unwrap();
    let a = event("wamid.first", "97333112233");
    let b = event("wamid.second", "97333112233");
    let (a, b) = tokio::join!(enqueue(&state, &a), enqueue(&state, &b));
    a.unwrap();
    b.unwrap();
    let (a, b) = tokio::join!(tick(&state), tick(&state));
    a.unwrap();
    b.unwrap();
    enqueue(&state, &event("wamid.third", "97333112233"))
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    let message = mock.messages.lock().unwrap()[0].clone();
    assert_eq!(message["type"], "text");
    assert_eq!(message["to"], "97333112233");
    assert_eq!(message["text"]["body"], input(true).message);
    assert_eq!(message["text"]["preview_url"], false);
    // Cooldown expires, but replaying a handled message still cannot send again.
    sqlx::query("UPDATE whatsapp_auto_reply_contacts SET last_attempt_at=clock_timestamp()-interval '25 hours'").execute(&pool).await.unwrap();
    enqueue(&state, &event("wamid.first", "97333112233"))
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    enqueue(&state, &event("wamid.fresh", "97333112233"))
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
}

#[sqlx::test]
async fn global_limit_and_switch_off_apply_across_workers_and_cancel_pending_replies(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    let mut options = input(true);
    options.max_per_minute = 1;
    update(&state, options, "manager").await.unwrap();
    enqueue(&state, &event("wamid.a", "97333112233"))
        .await
        .unwrap();
    enqueue(&state, &event("wamid.b", "97333991122"))
        .await
        .unwrap();
    let (a, b) = tokio::join!(tick(&state), tick(&state));
    a.unwrap();
    b.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    assert_eq!(status(&pool, "wamid.b").await, "queued");
    sqlx::query("UPDATE whatsapp_auto_replies SET attempted_at=clock_timestamp()-interval '61 seconds' WHERE attempted_at IS NOT NULL").execute(&pool).await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    enqueue(&state, &event("wamid.c", "97333223344"))
        .await
        .unwrap();
    update(&state, input(false), "manager").await.unwrap();
    assert_eq!(status(&pool, "wamid.c").await, "cancelled");
    update(&state, input(true), "manager").await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
}

#[sqlx::test]
async fn ignores_foreign_numbers_reactions_echoes_system_stale_and_future_messages(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    update(&state, input(true), "manager").await.unwrap();
    let base = event("wamid.ignored", "97333112233");
    for kind in ["reaction", "system", "unsupported"] {
        let mut body = base.clone();
        body["entry"][0]["changes"][0]["value"]["messages"][0]["type"] = json!(kind);
        enqueue(&state, &body).await.unwrap();
    }
    for field in ["smb_message_echoes", "history", "smb_app_state_sync"] {
        let mut body = base.clone();
        body["entry"][0]["changes"][0]["field"] = json!(field);
        enqueue(&state, &body).await.unwrap();
    }
    let mut body = base.clone();
    body["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] =
        json!("another-number");
    enqueue(&state, &body).await.unwrap();
    enqueue(&state, &event("wamid.self", "97333000000"))
        .await
        .unwrap();
    for delta in [-24, 1] {
        let mut body = base.clone();
        body["entry"][0]["changes"][0]["value"]["messages"][0]["timestamp"] = json!((Utc::now()
            + Duration::hours(delta))
        .timestamp()
        .to_string());
        enqueue(&state, &body).await.unwrap();
    }
    tick(&state).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM whatsapp_auto_replies")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert!(mock.messages.lock().unwrap().is_empty());
}

#[sqlx::test]
async fn username_only_customers_receive_replies_and_stale_queued_messages_expire(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    update(&state, input(true), "manager").await.unwrap();
    let mut body = event("wamid.username", "");
    body["entry"][0]["changes"][0]["value"]["messages"][0]["from_user_id"] = json!("US.123456");
    enqueue(&state, &body).await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap()[0]["recipient"], "US.123456");
    assert!(mock.messages.lock().unwrap()[0].get("to").is_none());
    enqueue(&state, &event("wamid.expired", "97333112233"))
        .await
        .unwrap();
    sqlx::query("UPDATE whatsapp_auto_replies SET received_at=clock_timestamp()-interval '24 hours' WHERE inbound_message_id='wamid.expired'").execute(&pool).await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(status(&pool, "wamid.expired").await, "cancelled");
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
}

#[sqlx::test]
async fn uncertain_and_failed_submissions_keep_cooldown_and_are_never_retried(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    update(&state, input(true), "manager").await.unwrap();
    for (response, id, from, expected) in [
        (1, "wamid.failure", "97333112233", "failed"),
        (2, "wamid.unknown", "97333991122", "uncertain"),
    ] {
        mock.response.store(response, Ordering::SeqCst);
        enqueue(&state, &event(id, from)).await.unwrap();
        tick(&state).await.unwrap();
        tick(&state).await.unwrap();
        assert_eq!(status(&pool, id).await, expected);
        enqueue(&state, &event(&format!("{id}.again"), from))
            .await
            .unwrap();
        tick(&state).await.unwrap();
    }
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
    enqueue(&state, &event("wamid.crash", "97333223344"))
        .await
        .unwrap();
    repository::claim(&pool, Some("test-phone"), true)
        .await
        .unwrap()
        .unwrap();
    sqlx::query("UPDATE whatsapp_auto_replies SET attempted_at=clock_timestamp()-interval '4 minutes' WHERE inbound_message_id='wamid.crash'").execute(&pool).await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(status(&pool, "wamid.crash").await, "uncertain");
    assert_eq!(mock.messages.lock().unwrap().len(), 2);
}

#[sqlx::test]
async fn invalid_signatures_cannot_queue_replies_and_delivery_statuses_do_not_reply(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    update(&state, input(true), "manager").await.unwrap();
    let body = serde_json::to_vec(&event("wamid.signed", "97333112233")).unwrap();
    assert!(matches!(
        handlers::webhook(State(state.clone()), HeaderMap::new(), body.clone().into()).await,
        Err(AppError::Unauthorized(_))
    ));
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(b"test-webhook-secret").unwrap();
    use hmac::Mac;
    mac.update(&body);
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-hub-signature-256",
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
            .parse()
            .unwrap(),
    );
    handlers::webhook(State(state.clone()), headers, body.into())
        .await
        .unwrap();
    tick(&state).await.unwrap();
    worker::receive_webhook(&state, &serde_json::to_vec(&json!({"entry":[{"changes":[{"field":"messages","value":{"statuses":[{"id":"wamid.reply.1","status":"delivered"}]}}]}]})).unwrap()).await.unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap().len(), 1);
    let pending: i64 =
        sqlx::query_scalar("SELECT count(*) FROM whatsapp_webhook_events WHERE NOT processed")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(pending, 0);
}

#[sqlx::test]
async fn validates_settings_and_global_delivery_switch(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    let mut bad = input(true);
    bad.message = "  ".into();
    assert!(matches!(
        update(&state, bad, "manager").await,
        Err(AppError::BadRequest(_))
    ));
    let mut bad = input(true);
    bad.cooldown_hours = 0;
    assert!(matches!(
        update(&state, bad, "manager").await,
        Err(AppError::BadRequest(_))
    ));
    let mut bad = input(true);
    bad.max_per_minute = 61;
    assert!(matches!(
        update(&state, bad, "manager").await,
        Err(AppError::BadRequest(_))
    ));
    update(&state, input(true), "manager").await.unwrap();
    enqueue(&state, &event("wamid.global-off", "97333112233"))
        .await
        .unwrap();
    // A worker with delivery disabled must cancel pending automatic replies.
    repository::claim(&pool, Some("test-phone"), false)
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert_eq!(status(&pool, "wamid.global-off").await, "cancelled");
    assert!(mock.messages.lock().unwrap().is_empty());
}

#[sqlx::test]
async fn link_buttons_round_trip_send_once_and_can_be_removed(pool: PgPool) {
    let (state, mock) = state(&pool).await;
    let mut options = input(true);
    options.button = Some(LinkButton {
        label: "  Chat with us  ".into(),
        url: "  https://wa.me/97333112233  ".into(),
    });
    let saved = update(&state, options, "manager").await.unwrap();
    let json = serde_json::to_value(&saved).unwrap();
    assert_eq!(
        json["button"],
        json!({"label":"Chat with us", "url":"https://wa.me/97333112233"})
    );
    assert_eq!(
        settings(&state).await.unwrap().button.unwrap().label,
        "Chat with us"
    );
    let inbound = event("wamid.link", "97333112233");
    enqueue(&state, &inbound).await.unwrap();
    tick(&state).await.unwrap();
    enqueue(&state, &inbound).await.unwrap();
    enqueue(&state, &event("wamid.link.again", "97333112233"))
        .await
        .unwrap();
    tick(&state).await.unwrap();
    let messages = mock.messages.lock().unwrap().clone();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0],
        json!({
            "messaging_product":"whatsapp", "to":"97333112233", "type":"interactive",
            "interactive":{
                "type":"cta_url", "body":{"text":input(true).message},
                "action":{"name":"cta_url", "parameters":{"display_text":"Chat with us","url":"https://wa.me/97333112233"}}
            }
        })
    );
    let saved = update(&state, input(true), "manager").await.unwrap();
    assert!(saved.button.is_none());
    enqueue(&state, &event("wamid.no-link", "97333991122"))
        .await
        .unwrap();
    tick(&state).await.unwrap();
    assert_eq!(mock.messages.lock().unwrap()[1]["type"], "text");
}

#[sqlx::test]
async fn rejects_invalid_button_labels_urls_and_oversized_interactive_messages(pool: PgPool) {
    let (state, _) = state(&pool).await;
    for url in [
        "javascript:alert(1)",
        "https:example.com",
        "https://",
        "https://user:pass@example.com",
        "https://example.com/a b",
        "file:///tmp/file",
    ] {
        let mut bad = input(false);
        bad.button = Some(LinkButton {
            label: "Help".into(),
            url: url.into(),
        });
        assert!(
            matches!(
                update(&state, bad, "manager").await,
                Err(AppError::BadRequest(_))
            ),
            "URL should be rejected: {url}"
        );
    }
    for label in [" ".to_string(), "x".repeat(21), "Help\nnow".into()] {
        let mut bad = input(false);
        bad.button = Some(LinkButton {
            label,
            url: "https://example.com".into(),
        });
        assert!(matches!(
            update(&state, bad, "manager").await,
            Err(AppError::BadRequest(_))
        ));
    }
    let mut bad = input(false);
    bad.message = "a".repeat(1025);
    bad.button = Some(LinkButton {
        label: "Website".into(),
        url: "https://example.com".into(),
    });
    assert!(matches!(
        update(&state, bad, "manager").await,
        Err(AppError::BadRequest(_))
    ));
    let mut plain = input(false);
    plain.message = "a".repeat(4096);
    assert!(update(&state, plain, "manager").await.is_ok());
}
