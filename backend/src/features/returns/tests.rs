use super::{service, types::*};
use crate::{features::orders::readiness, test_support};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[test]
fn typed_request_hashes_apply_defaults_and_detect_changed_financial_intent() {
    use crate::idempotency::request_hash;
    let target = Uuid::new_v4();
    let minimal = json!({"requestId":Uuid::new_v4(), "reason":"Changed plans"});
    let input: CreateCancellationInput = serde_json::from_value(minimal.clone()).unwrap();
    let hash = request_hash("order.cancel.v1", target, &input);
    let mut explicit = serde_json::to_value(&input).unwrap();
    explicit["retainedCharge"] = json!(-0.0);
    explicit["requestId"] = json!(Uuid::new_v4());
    let equivalent: CreateCancellationInput = serde_json::from_value(explicit.clone()).unwrap();
    assert_eq!(hash, request_hash("order.cancel.v1", target, &equivalent));
    for (field, value) in [
        ("reason", json!("Another reason")),
        ("retainedCharge", json!(10)),
        ("restoredMaterialQuantity", json!(1)),
        ("workChargeConfirmed", json!(true)),
        ("unusedMaterialConfirmed", json!(true)),
        ("refund", json!({"timing":"later"})),
    ] {
        let mut changed = explicit.clone();
        changed[field] = value;
        let changed: CreateCancellationInput = serde_json::from_value(changed).unwrap();
        assert_ne!(
            hash,
            request_hash("order.cancel.v1", target, &changed),
            "{field}"
        );
    }
    let original = json!({"requestId":Uuid::new_v4(),"reason":"Wrong size",
        "lines":[{"lineId":Uuid::new_v4(),"quantity":1,"restock":false}],
        "refund":{"timing":"now","payments":[{"amount":10,"paymentType":"cash","giftCardId":null}]}});
    let input: CreateReturnInput = serde_json::from_value(original.clone()).unwrap();
    let hash = request_hash("invoice.return.v2", target, &input);
    for (path, value) in [
        ("/lines/0/quantity", json!(2)),
        ("/lines/0/restock", json!(true)),
        ("/refund/payments/0/amount", json!(20)),
        ("/refund/payments/0/paymentType", json!("card")),
        ("/refund/payments/0/giftCardId", json!(Uuid::new_v4())),
    ] {
        let mut changed = original.clone();
        *changed
            .pointer_mut(path)
            .unwrap_or_else(|| panic!("missing {path}")) = value;
        let changed: CreateReturnInput = serde_json::from_value(changed).unwrap();
        assert_ne!(
            hash,
            request_hash("invoice.return.v2", target, &changed),
            "{path}"
        );
    }
}

#[sqlx::test]
async fn cancellation_hash_replays_once_and_binds_the_order(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 2, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let payload = json!({"requestId":Uuid::new_v4(),"reason":"Changed plans"});
    let first = service::cancel_order(
        &state,
        orders[0],
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let revision: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    let replay = service::cancel_order(
        &state,
        orders[0],
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(first.id, replay.id);
    let after: i64 = sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
        .bind(invoice)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision, after);
    assert!(matches!(
        service::cancel_order(
            &state,
            orders[1],
            serde_json::from_value(payload.clone()).unwrap(),
            "staff"
        )
        .await,
        Err(crate::error::AppError::Conflict(_))
    ));
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT request_hash FROM invoice_returns WHERE id=$1")
            .bind(first.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let input: CreateCancellationInput = serde_json::from_value(payload).unwrap();
    assert_eq!(
        stored,
        crate::idempotency::request_hash("order.cancel.v1", orders[0], &input)
    );
    assert_eq!(
        service::context(&state, invoice)
            .await
            .unwrap()
            .returns
            .len(),
        1
    );
}

#[sqlx::test]
async fn concurrent_return_replay_restores_the_original_card_only_once(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE invoices SET gift_card_redeemed=100 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    let card: Uuid = sqlx::query_scalar("INSERT INTO gift_cards(code,initial_amount,balance) VALUES('HASH-RETURN',100,0) RETURNING id").fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO gift_card_redemptions(gift_card_id,invoice_id,amount) VALUES($1,$2,100)",
    )
    .bind(card)
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let payload = json!({"requestId":Uuid::new_v4(),"reason":"Wrong size",
        "lines":[{"lineId":orders[0],"quantity":1,"restock":false}],
        "refund":{"timing":"now","payments":[{"amount":100,"paymentType":"gift_card","giftCardId":card}]}});
    let (first, second) = tokio::join!(
        service::create_return(
            &state,
            invoice,
            serde_json::from_value(payload.clone()).unwrap(),
            "staff"
        ),
        service::create_return(
            &state,
            invoice,
            serde_json::from_value(payload).unwrap(),
            "staff"
        )
    );
    assert_eq!(first.unwrap().id, second.unwrap().id);
    let balance: f64 = sqlx::query_scalar("SELECT balance::float8 FROM gift_cards WHERE id=$1")
        .bind(card)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 100.0);
    let context = service::context(&state, invoice).await.unwrap();
    assert_eq!(context.returns.len(), 1);
    assert_eq!(context.refunds.len(), 1);
    assert_eq!(context.settlement.refund_due, 0.0);
}

#[sqlx::test]
async fn deferred_refund_hash_replays_and_allows_correction_after_rollback(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,100,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut cancel = cancellation();
    cancel.refund = RefundPlan::Later;
    service::cancel_order(&state, orders[0], cancel, "staff")
        .await
        .unwrap();
    let mut payload = json!({"requestId":Uuid::new_v4(),"reason":"Deferred payout","amount":101,"paymentType":"cash"});
    assert!(service::create_refund(
        &state,
        invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff"
    )
    .await
    .is_err());
    payload["amount"] = json!(100);
    let first = service::create_refund(
        &state,
        invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let second = service::create_refund(
        &state,
        invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(first.id, second.id);
    payload["paymentType"] = json!("card");
    assert!(matches!(
        service::create_refund(
            &state,
            invoice,
            serde_json::from_value(payload).unwrap(),
            "staff"
        )
        .await,
        Err(crate::error::AppError::Conflict(_))
    ));
    let context = service::context(&state, invoice).await.unwrap();
    assert_eq!(context.refunds.len(), 1);
    assert_eq!(context.settlement.refund_due, 0.0);
}

fn cancellation() -> CreateCancellationInput {
    serde_json::from_value(json!({
        "requestId": Uuid::new_v4(), "reason": "Customer changed plans"
    }))
    .unwrap()
}

#[sqlx::test]
async fn cancellation_and_return_credit_only_their_own_undiscounted_urgency_fee(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 2, false).await;
    sqlx::query("UPDATE invoices SET total_price=185,discount=10,discount_unit='percent',urgent_charge=5 WHERE id=$1")
        .bind(invoice).execute(&pool).await.unwrap();
    sqlx::query("UPDATE orders SET is_urgent=true,urgent_charge=5 WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,185,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut input = cancellation();
    input.refund = RefundPlan::Now {
        payments: vec![RefundTender {
            amount: 95.0,
            payment_type: RefundMethod::Cash,
            gift_card_id: None,
        }],
    };
    service::cancel_order(&state, orders[0], input, "staff")
        .await
        .unwrap();
    let context = service::context(&state, invoice).await.unwrap();
    assert_eq!(context.settlement.amount_credited, 95.0);
    assert_eq!(context.settlement.net_total, 90.0);
    assert_eq!(context.settlement.refund_due, 0.0);
    let page = crate::features::invoices::service::list_invoices(&state, &Default::default())
        .await
        .unwrap();
    let listed = page.data.iter().find(|row| row.id == invoice).unwrap();
    assert_eq!(listed.total_price, 185.0);
    assert_eq!(listed.net_total, 90.0);
    assert_eq!(listed.amount_paid, 90.0);
    assert_eq!(listed.amount_credited, 95.0);
    assert_eq!(listed.amount_refunded, 95.0);
    assert_eq!(listed.refund_due, 0.0);
    assert_eq!(listed.balance_due, 0.0);
    let detail = crate::features::invoices::service::get_invoice(&state, invoice)
        .await
        .unwrap();
    assert_eq!(detail.totals.total, 185.0);
    assert_eq!(detail.totals.amount_paid, 185.0);
    assert_eq!(detail.totals.total, listed.total_price);
    assert_eq!(detail.totals.net_total, listed.net_total);
    assert_eq!(detail.totals.net_amount_paid, listed.amount_paid);
    assert_eq!(detail.totals.net_gift_card_redeemed, 0.0);
    sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
        .bind(orders[1])
        .execute(&pool)
        .await
        .unwrap();
    service::create_return(
        &state,
        invoice,
        serde_json::from_value(json!({
            "requestId":Uuid::new_v4(),"reason":"Return collected garment",
            "lines":[{"lineId":orders[1],"quantity":1,"restock":false}],
            "refund":{"timing":"now","payments":[{"amount":90,"paymentType":"cash"}]}
        }))
        .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let context = service::context(&state, invoice).await.unwrap();
    assert_eq!(context.settlement.net_total, 0.0);
    assert_eq!(context.settlement.amount_credited, 185.0);
    assert_eq!(context.settlement.cash_refunded, 185.0);
}

#[sqlx::test]
async fn cancelling_pending_order_can_make_remaining_orders_ready(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 2, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, Some(orders[0]), "staff", true)
        .await
        .unwrap();
    let before = readiness::summary(&pool, invoice).await.unwrap();
    assert_eq!(before.readiness_status, "partially_ready");
    let state = test_support::state(pool.clone(), None, None).await;
    service::cancel_order(&state, orders[1], cancellation(), "staff")
        .await
        .unwrap();
    let after = readiness::summary(&pool, invoice).await.unwrap();
    assert_eq!(after.readiness_status, "ready");
    assert_eq!(after.pending_order_count, 0);
    assert_eq!(after.ready_order_count, 1);
    assert_eq!(after.readiness_generation, before.readiness_generation + 1);
    let bulk = readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    assert_eq!(bulk.order_ids, vec![orders[0]]);
    assert_eq!(
        bulk.readiness.readiness_generation,
        after.readiness_generation
    );
    assert!(
        readiness::confirm(&pool, invoice, Some(orders[1]), "staff", true)
            .await
            .is_err()
    );
    let original_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(orders[1])
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(original_status, "pending");
}

#[sqlx::test]
async fn ready_order_can_be_cancelled_but_never_reopened(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let ready_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT ready_at FROM orders WHERE id=$1")
            .bind(orders[0])
            .fetch_one(&pool)
            .await
            .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut input = cancellation();
    input.retained_charge = 25.0;
    input.work_charge_confirmed = true;
    service::cancel_order(&state, orders[0], input, "staff")
        .await
        .unwrap();
    let context = service::context(&state, invoice).await.unwrap();
    assert_eq!(context.settlement.amount_credited, 75.0);
    assert_eq!(context.settlement.balance_due, 25.0);
    assert_eq!(context.lines[0].outcome, "cancelled");
    let summary = readiness::summary(&pool, invoice).await.unwrap();
    assert_eq!(summary.readiness_status, "not_applicable");
    assert_eq!(summary.ready_order_count, 0);
    assert!(readiness::reopen(&pool, orders[0], "staff", "Resume")
        .await
        .is_err());
    assert!(
        readiness::confirm(&pool, invoice, Some(orders[0]), "staff", true)
            .await
            .is_err()
    );
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT ready_at FROM orders WHERE id=$1")
            .bind(orders[0])
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after, ready_at);
}

#[sqlx::test]
async fn collected_return_and_deferred_refund_invalidate_previews_atomically(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,100,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let revision: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut payload = json!({
        "requestId": Uuid::new_v4(), "reason": "Fit issue after collection",
        "lines": [{"lineId": orders[0], "quantity": 1, "restock": false}],
        "refund": {"timing": "now", "payments": [{"amount": 99, "paymentType": "cash"}]}
    });
    assert!(service::create_return(
        &state,
        invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff"
    )
    .await
    .is_err());
    let after_failure: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after_failure, revision);
    assert!(service::context(&state, invoice)
        .await
        .unwrap()
        .returns
        .is_empty());
    payload["refund"] = json!({"timing": "later"});
    service::create_return(
        &state,
        invoice,
        serde_json::from_value(payload).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let after_return: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(after_return > revision);
    assert_eq!(
        service::context(&state, invoice)
            .await
            .unwrap()
            .settlement
            .refund_due,
        100.0
    );
    let page = crate::features::invoices::service::list_invoices(&state, &Default::default())
        .await
        .unwrap();
    let listed = page.data.iter().find(|row| row.id == invoice).unwrap();
    assert_eq!(listed.total_price, 100.0);
    assert_eq!(listed.net_total, 0.0);
    assert_eq!(listed.amount_paid, 100.0);
    assert_eq!(listed.amount_refunded, 0.0);
    assert_eq!(listed.refund_due, 100.0);
    service::create_refund(
        &state,
        invoice,
        CreateRefundInput {
            request_id: Uuid::new_v4(),
            reason: "Pay deferred refund".into(),
            amount: 100.0,
            payment_type: RefundMethod::Cash,
            gift_card_id: None,
        },
        "staff",
    )
    .await
    .unwrap();
    let after_refund: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(after_refund > after_return);
    let page = crate::features::invoices::service::list_invoices(&state, &Default::default())
        .await
        .unwrap();
    let listed = page.data.iter().find(|row| row.id == invoice).unwrap();
    assert_eq!(listed.total_price, 100.0);
    assert_eq!(listed.net_total, 0.0);
    assert_eq!(listed.amount_paid, 0.0);
    assert_eq!(listed.amount_refunded, 100.0);
    assert_eq!(listed.refund_due, 0.0);
    assert_eq!(
        service::context(&state, invoice)
            .await
            .unwrap()
            .settlement
            .refund_due,
        0.0
    );
    let original_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id=$1")
        .bind(orders[0])
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(original_status, "collected");
}
