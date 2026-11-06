use super::{
    repository, service,
    types::{GiftCard, ReplaceGiftCardInput},
};
use crate::{
    error::AppError,
    features::{invoices, returns},
    state::AppState,
    test_support,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

fn replacement_input(expires_on: Option<chrono::NaiveDate>) -> ReplaceGiftCardInput {
    serde_json::from_value(json!({"expiresOn":expires_on})).unwrap()
}

async fn standalone(state: &AppState, amount: f64) -> GiftCard {
    service::create_gift_card(
        state,
        serde_json::from_value(json!({
            "amount":amount,"recipientPhone":"33112233","boughtFor":"Recipient"
        }))
        .unwrap(),
        "original-issuer",
    )
    .await
    .unwrap()
}

async fn paid(state: &AppState) -> (Uuid, GiftCard) {
    let sale = invoices::service::create_invoice(
        state,
        serde_json::from_value(json!({
            "expectedVatRate":0.1,"discountUnit":"amount",
            "giftCards":[{"amount":110,"recipientPhone":"33112233","boughtFor":"Recipient"}]
        }))
        .unwrap(),
        "seller",
    )
    .await
    .unwrap();
    (
        sale.id,
        service::get_gift_card_by_code(state, &sale.gift_cards[0].code)
            .await
            .unwrap(),
    )
}

async fn stock(pool: &PgPool) -> (Uuid, Uuid) {
    let branch: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock) VALUES('Replacement test',true) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let product: Uuid = sqlx::query_scalar(
        "INSERT INTO products(name,unit_price) VALUES('Shirt',110) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,20)")
        .bind(product)
        .bind(branch)
        .execute(pool)
        .await
        .unwrap();
    (product, branch)
}

fn purchase(product: Uuid, branch: Uuid, card: &GiftCard, amount: f64) -> Value {
    json!({"expectedVatRate":0.1,"discountUnit":"amount",
        "products":[{"productId":product,"branchId":branch,"quantity":1,"unitPrice":amount}],
        "giftCardRedemptions":[{"code":card.code,"amount":amount}]})
}

/// Replacements move only unspent value and preserve the original paid-VAT provenance.
#[sqlx::test]
async fn paid_replacement_chain_preserves_balances_links_and_tax(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (_, original) = paid(&state).await;
    let (product, branch) = stock(&pool).await;
    invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &original, 55.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let replacement = service::replace_gift_card(
        &state,
        original.id,
        replacement_input(None),
        "replacement-issuer",
    )
    .await
    .unwrap();
    assert_eq!(replacement.balance, 55.0);
    assert_eq!(replacement.initial_amount, 55.0);
    assert_eq!(replacement.replaces_card_id, Some(original.id));
    assert_eq!(
        replacement.replaces_card_code.as_deref(),
        Some(original.code.as_str())
    );
    assert_eq!(replacement.issued_by.as_deref(), Some("replacement-issuer"));
    assert_eq!(
        (
            &replacement.bought_for,
            &replacement.recipient_phone,
            replacement.customer_id,
            replacement.expires_on
        ),
        (
            &original.bought_for,
            &original.recipient_phone,
            original.customer_id,
            original.expires_on
        )
    );
    assert!(replacement.taxed_at_issue);
    let retired = service::get_gift_card_by_code(&state, &original.code)
        .await
        .unwrap();
    assert_eq!(
        (
            retired.balance,
            retired.is_active,
            retired.replaced_by_card_id
        ),
        (0.0, false, Some(replacement.id))
    );
    assert_eq!(
        retired.replaced_by_card_code.as_deref(),
        Some(replacement.code.as_str())
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2, "replacement creates no invoice");
    invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &replacement, 22.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let final_card = service::replace_gift_card(
        &state,
        replacement.id,
        replacement_input(None),
        "next-issuer",
    )
    .await
    .unwrap();
    assert_eq!(final_card.replaces_card_id, Some(replacement.id));
    assert_eq!(final_card.balance, 33.0);
    assert!(final_card.taxed_at_issue);
    let final_sale = invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &final_card, 33.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let detail = invoices::service::get_invoice(&state, final_sale.id)
        .await
        .unwrap();
    assert_eq!(
        (detail.totals.vat, detail.totals.prepaid_amount),
        (0.0, 33.0)
    );
    assert_eq!(detail.document_kind, "redemption_receipt");
    let vat: f64 = sqlx::query_scalar("SELECT SUM(vat_amount)::float8 FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    let sales: f64 =
        sqlx::query_scalar("SELECT SUM(sales_amount)::float8 FROM invoice_voucher_accounting")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((vat, sales), (10.0, 100.0));
    for old in [&original, &replacement] {
        let mut tx = pool.begin().await.unwrap();
        assert!(
            service::redeem(&mut tx, &old.code, 1.0, chrono::Utc::now().date_naive())
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        assert!(matches!(
            service::update_gift_card(
                &state,
                old.id,
                serde_json::from_value(json!({"isActive":true})).unwrap()
            )
            .await,
            Err(AppError::Conflict(_))
        ));
    }
}

/// Free credit keeps its tax treatment after replacement instead of becoming prepaid VAT.
#[sqlx::test]
async fn uninvoiced_replacement_is_linked_without_creating_a_sale(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = standalone(&state, 110.0).await;
    let replacement =
        service::replace_gift_card(&state, original.id, replacement_input(None), "new-issuer")
            .await
            .unwrap();
    assert!(!replacement.taxed_at_issue);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let (product, branch) = stock(&pool).await;
    let created = invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &replacement, 110.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let detail = invoices::service::get_invoice(&state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (detail.totals.vat, detail.totals.prepaid_amount),
        (10.0, 0.0)
    );
    assert_eq!(detail.document_kind, "tax_invoice");
}

/// Existing tender may be edited/refunded through a retired code; new purchases may not use it.
#[sqlx::test]
async fn edits_and_returns_restore_value_to_the_current_replacement(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (_, original) = paid(&state).await;
    let (product, branch) = stock(&pool).await;
    let created = invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &original, 55.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let replacement =
        service::replace_gift_card(&state, original.id, replacement_input(None), "issuer")
            .await
            .unwrap();
    let current =
        service::replace_gift_card(&state, replacement.id, replacement_input(None), "issuer")
            .await
            .unwrap();
    let edit = invoices::service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    let mut payload = purchase(product, branch, &original, 33.0);
    payload["products"][0]["originalItemId"] = json!(edit.products[0].original_item_id);
    invoices::service::update_invoice(&state, created.id, serde_json::from_value(payload).unwrap())
        .await
        .unwrap();
    assert_eq!(
        service::get_gift_card_by_code(&state, &current.code)
            .await
            .unwrap()
            .balance,
        77.0
    );
    let detail = invoices::service::get_invoice(&state, created.id)
        .await
        .unwrap();
    assert_eq!(detail.redemptions[0].code, original.code);
    assert_eq!(
        (detail.totals.vat, detail.totals.prepaid_amount),
        (0.0, 33.0)
    );
    let return_context = returns::service::context(&state, created.id).await.unwrap();
    returns::service::create_return(&state,created.id,serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"reason":"Returned shirt",
        "lines":[{"lineId":return_context.lines[0].line_id,"quantity":1,"restock":false}],
        "refund":{"timing":"now","payments":[{"amount":33,"paymentType":"gift_card","giftCardId":original.id}]}
    })).unwrap(),"manager").await.unwrap();
    assert_eq!(
        service::get_gift_card_by_code(&state, &current.code)
            .await
            .unwrap()
            .balance,
        110.0
    );
    for old in [&original, &replacement] {
        assert_eq!(
            service::get_gift_card_by_code(&state, &old.code)
                .await
                .unwrap()
                .balance,
            0.0
        );
    }
}

/// Replacement alone is sufficient to protect the original sale from invoice rebuilding.
#[sqlx::test]
async fn replaced_sale_cannot_be_rebuilt_even_before_any_redemption(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (invoice, original) = paid(&state).await;
    service::replace_gift_card(&state, original.id, replacement_input(None), "issuer")
        .await
        .unwrap();
    let result=invoices::service::update_invoice(&state,invoice,serde_json::from_value(json!({
        "expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":110,"recipientPhone":"33112233"}]
    })).unwrap()).await;
    assert!(
        matches!(result,Err(AppError::BadRequest(message)) if message.contains("already been used"))
    );
}

/// Two replacement requests must serialize to one new card without duplicating stored value.
#[sqlx::test]
async fn concurrent_replacement_requests_have_one_winner(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = standalone(&state, 110.0).await;
    let (a, b) = tokio::join!(
        service::replace_gift_card(&state, original.id, replacement_input(None), "issuer-a"),
        service::replace_gift_card(&state, original.id, replacement_input(None), "issuer-b")
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let rows = service::list_gift_cards(&state, &Default::default())
        .await
        .unwrap();
    assert_eq!(rows.total, 2);
    assert_eq!(rows.data.iter().map(|c| c.balance).sum::<f64>(), 110.0);
}

/// Spending and replacing share the source lock, so the transferred balance excludes committed spend.
#[sqlx::test]
async fn concurrent_spending_and_replacement_preserve_value(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = standalone(&state, 110.0).await;
    let spend = async {
        let mut tx = pool.begin().await.unwrap();
        let result = service::redeem(
            &mut tx,
            &original.code,
            55.0,
            chrono::Utc::now().date_naive(),
        )
        .await;
        if result.is_ok() {
            tx.commit().await.unwrap()
        } else {
            tx.rollback().await.unwrap()
        }
        result
    };
    let (spend, replacement) = tokio::join!(
        spend,
        service::replace_gift_card(&state, original.id, replacement_input(None), "issuer")
    );
    let replacement = replacement.unwrap();
    assert_eq!(
        replacement.balance,
        if spend.is_ok() { 55.0 } else { 110.0 }
    );
    assert_eq!(
        service::get_gift_card_by_code(&state, &original.code)
            .await
            .unwrap()
            .balance,
        0.0
    );
}

/// Unusable source cards must fail before generating any replacement or changing balances.
#[sqlx::test]
async fn invalid_replacements_leave_the_source_untouched(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    for changes in [json!({"balance":0}), json!({"is_active":false})] {
        let card = standalone(&state, 110.0).await;
        sqlx::query("UPDATE gift_cards SET balance=COALESCE(($2->>'balance')::numeric,balance),is_active=COALESCE(($2->>'is_active')::boolean,is_active),expires_on=COALESCE(($2->>'expires_on')::date,expires_on) WHERE id=$1").bind(card.id).bind(changes).execute(&pool).await.unwrap();
        assert!(
            service::replace_gift_card(&state, card.id, replacement_input(None), "issuer")
                .await
                .is_err()
        );
        assert!(repository::get_gift_card(&state, card.id)
            .await
            .unwrap()
            .unwrap()
            .replaced_by_card_id
            .is_none());
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gift_cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

/// Renew an expired uninvoiced balance without changing its original expiry or VAT history.
#[sqlx::test]
async fn expired_uninvoiced_credit_can_be_replaced_with_a_new_expiry(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = service::create_gift_card(
        &state,
        serde_json::from_value(json!({
            "amount":110,"recipientPhone":"33112233","expiresOn":"2000-01-01"
        }))
        .unwrap(),
        "issuer",
    )
    .await
    .unwrap();
    let future = chrono::Utc::now().date_naive() + chrono::Duration::days(365);
    let renewed = service::replace_gift_card(
        &state,
        original.id,
        replacement_input(Some(future)),
        "renewing-manager",
    )
    .await
    .unwrap();
    assert_eq!(renewed.expires_on, Some(future));
    assert_eq!(renewed.balance, 110.0);
    assert_eq!(renewed.replaces_card_id, Some(original.id));
    assert_eq!(renewed.issued_by.as_deref(), Some("renewing-manager"));
    assert!(!renewed.taxed_at_issue);
    let retired = service::get_gift_card_by_code(&state, &original.code)
        .await
        .unwrap();
    assert_eq!(retired.expires_on, original.expires_on);
    assert_eq!(
        (
            retired.balance,
            retired.is_active,
            retired.replaced_by_card_id
        ),
        (0.0, false, Some(renewed.id))
    );
    assert_eq!(
        retired.replaced_by_card_code.as_deref(),
        Some(renewed.code.as_str())
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let (product, branch) = stock(&pool).await;
    let purchase = invoices::service::create_invoice(
        &state,
        serde_json::from_value(purchase(product, branch, &renewed, 33.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let detail = invoices::service::get_invoice(&state, purchase.id)
        .await
        .unwrap();
    assert_eq!(
        (detail.totals.vat, detail.totals.prepaid_amount),
        (3.0, 0.0)
    );
}

/// Expiry renewal stays available through an uninvoiced replacement chain, including no expiry.
#[sqlx::test]
async fn expired_uninvoiced_replacement_can_receive_no_expiry(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = standalone(&state, 55.0).await;
    let first = service::replace_gift_card(&state, original.id, replacement_input(None), "issuer")
        .await
        .unwrap();
    sqlx::query("UPDATE gift_cards SET expires_on='2000-01-01' WHERE id=$1")
        .bind(first.id)
        .execute(&pool)
        .await
        .unwrap();
    let renewed = service::replace_gift_card(&state, first.id, replacement_input(None), "manager")
        .await
        .unwrap();
    assert_eq!(renewed.expires_on, None);
    assert_eq!(renewed.balance, 55.0);
    assert!(!renewed.taxed_at_issue);
    assert_eq!(renewed.replaces_card_id, Some(first.id));
}

/// Reject a requested past expiry atomically rather than issuing another expired code.
#[sqlx::test]
async fn past_replacement_expiry_is_rejected_without_transferring_value(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let original = standalone(&state, 55.0).await;
    let yesterday = chrono::Utc::now().date_naive() - chrono::Duration::days(1);
    let result = service::replace_gift_card(
        &state,
        original.id,
        replacement_input(Some(yesterday)),
        "manager",
    )
    .await;
    assert!(
        matches!(result, Err(AppError::BadRequest(message)) if message.contains("expiry date today or later"))
    );
    let source = service::get_gift_card_by_code(&state, &original.code)
        .await
        .unwrap();
    assert_eq!(
        (source.balance, source.is_active, source.replaced_by_card_id),
        (55.0, true, None)
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM gift_cards")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

/// A paid replacement retains its expiry rules even though its own record has no sale invoice.
#[sqlx::test]
async fn paid_value_cannot_bypass_expiry_through_a_replacement_chain(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (_, original) = paid(&state).await;
    let replacement =
        service::replace_gift_card(&state, original.id, replacement_input(None), "manager")
            .await
            .unwrap();
    let future = chrono::Utc::now().date_naive() + chrono::Duration::days(365);
    let result = service::replace_gift_card(
        &state,
        replacement.id,
        replacement_input(Some(future)),
        "manager",
    )
    .await;
    assert!(
        matches!(result, Err(AppError::BadRequest(message)) if message.contains("without a sale invoice"))
    );
    sqlx::query("UPDATE gift_cards SET expires_on='2000-01-01' WHERE id=$1")
        .bind(replacement.id)
        .execute(&pool)
        .await
        .unwrap();
    let expired: chrono::NaiveDate = "2000-01-01".parse().unwrap();
    let result = service::replace_gift_card(
        &state,
        replacement.id,
        replacement_input(Some(expired)),
        "manager",
    )
    .await;
    assert!(matches!(result, Err(AppError::BadRequest(message)) if message.contains("expired")));
    let source = service::get_gift_card_by_code(&state, &replacement.code)
        .await
        .unwrap();
    assert_eq!(source.balance, 110.0);
    assert!(source.replaced_by_card_id.is_none());
}

#[test]
fn replacement_request_requires_an_explicit_nullable_expiry() {
    assert!(serde_json::from_value::<ReplaceGiftCardInput>(json!({})).is_err());
    assert!(
        serde_json::from_value::<ReplaceGiftCardInput>(json!({"expiresOn":"not-a-date"})).is_err()
    );
    assert!(serde_json::from_value::<ReplaceGiftCardInput>(
        json!({"expiresOn":null,"taxedAtIssue":false})
    )
    .is_err());
    assert!(serde_json::from_value::<ReplaceGiftCardInput>(json!({"expiresOn":null})).is_ok());
}
