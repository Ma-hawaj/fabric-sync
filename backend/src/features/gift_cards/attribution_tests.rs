use super::{handlers, repository, service, types::CreateGiftCardInput};
use crate::{
    auth::{AuthenticatedUser, TokenIntrospection},
    config::Config,
    error::AppError,
    test_support,
};
use axum::{extract::State, routing::post, Extension, Json, Router};
use serde_json::json;
use sqlx::PgPool;

async fn identity(subject: Option<&str>) -> AuthenticatedUser {
    let body = json!({"active":true,"sub":subject,"aud":["test-project"]});
    let provider = Router::new().route(
        "/introspect",
        post(move || {
            let body = body.clone();
            async move { Json(body) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
    let mut config = Config::from_env();
    config.oauth_introspection_url = Some(format!("http://{address}/introspect"));
    config.oauth_resource_audience = None;
    config.zitadel_project_id = Some("test-project".into());
    config.zitadel_organization_id = Some("test-org".into());
    let user = TokenIntrospection::discover(&config)
        .await
        .unwrap()
        .introspect_bearer_token("test-only-token")
        .await
        .unwrap();
    task.abort();
    user
}

fn input() -> CreateGiftCardInput {
    serde_json::from_value(json!({"amount":50,"recipientPhone":"33112233",
        "issuedBy":"forged-client-issuer","issued_by":"also-forged"}))
    .unwrap()
}

#[sqlx::test]
async fn standalone_issuer_is_authenticated_immutable_and_available_on_every_read(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let user = identity(Some("original-issuer")).await;
    let Json(created) =
        handlers::create_gift_card(State(state.clone()), Extension(user), Json(input()))
            .await
            .unwrap();
    assert_eq!(created.issued_by.as_deref(), Some("original-issuer"));
    let stored: Option<String> = sqlx::query_scalar("SELECT issued_by FROM gift_cards WHERE id=$1")
        .bind(created.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, created.issued_by);
    let updated = service::update_gift_card(
        &state,
        created.id,
        serde_json::from_value(
            json!({"boughtFor":"Updated recipient","issuedBy":"different-issuer"}),
        )
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(updated.issued_by, created.issued_by);
    assert_eq!(
        service::get_gift_card_by_code(&state, &created.code)
            .await
            .unwrap()
            .issued_by,
        created.issued_by
    );
    assert_eq!(
        repository::get_gift_card(&state, created.id)
            .await
            .unwrap()
            .unwrap()
            .issued_by,
        created.issued_by
    );
    assert_eq!(
        service::list_gift_cards(&state, &Default::default())
            .await
            .unwrap()
            .data[0]
            .issued_by,
        created.issued_by
    );
    let invoices: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(invoices, 0);
}

#[sqlx::test]
async fn standalone_issuance_requires_a_named_identity_before_writing(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    for subject in [None, Some(""), Some("  ")] {
        let user = identity(subject).await;
        let result =
            handlers::create_gift_card(State(state.clone()), Extension(user), Json(input())).await;
        assert!(matches!(result, Err(AppError::Unauthorized(_))));
    }
    let cards: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gift_cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cards, 0);
}

#[sqlx::test]
async fn invoice_cards_resolve_the_original_invoice_creator_after_edits(pool: PgPool) {
    use crate::features::invoices::service as invoices;
    let state = test_support::state(pool.clone(), None, None).await;
    let payload = json!({"expectedVatRate":0.1,"discountUnit":"amount",
        "giftCards":[{"amount":110,"recipientPhone":"33112233"}]});
    let created = invoices::create_invoice(
        &state,
        serde_json::from_value(payload.clone()).unwrap(),
        "invoice-issuer",
    )
    .await
    .unwrap();
    let before = service::get_gift_card_by_code(&state, &created.gift_cards[0].code)
        .await
        .unwrap();
    assert_eq!(before.issued_by.as_deref(), Some("invoice-issuer"));
    let edited =
        invoices::update_invoice(&state, created.id, serde_json::from_value(payload).unwrap())
            .await
            .unwrap();
    let after = service::get_gift_card_by_code(&state, &edited.gift_cards[0].code)
        .await
        .unwrap();
    assert_eq!(after.issued_by, before.issued_by);
}
