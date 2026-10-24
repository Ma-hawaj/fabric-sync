use super::{
    service,
    types::{PaymentType, RecordPaymentInput},
};
use crate::{error::AppError, test_support};
use sqlx::PgPool;
use uuid::Uuid;

fn payment(amount: f64) -> RecordPaymentInput {
    RecordPaymentInput {
        request_id: Uuid::new_v4(),
        amount,
        payment_type: PaymentType::Cash,
        order_id: None,
    }
}

#[test]
fn payment_api_requires_a_request_id_and_rejects_unrecognized_fields() {
    assert!(
        serde_json::from_value::<RecordPaymentInput>(serde_json::json!({
            "amount": 10, "paymentType": "cash"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<RecordPaymentInput>(serde_json::json!({
            "requestId":Uuid::new_v4(), "amount":10, "paymentType":"cash", "requestHash":"untrusted"
        }))
        .is_err()
    );
}

#[sqlx::test]
async fn fully_paid_payment_replays_without_a_new_row_or_revision(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let input = payment(100.0);
    let first = service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    let revision: i64 =
        sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
            .bind(invoice)
            .fetch_one(&pool)
            .await
            .unwrap();
    let second = service::record_payment(&state, invoice, input, "another-staff-member")
        .await
        .unwrap();
    assert_eq!(first.payment.id, second.payment.id);
    assert_eq!(first.payment.paid_at, second.payment.paid_at);
    assert_eq!(first.payment.recorded_by.as_deref(), Some("staff"));
    assert_eq!(second.payment.recorded_by, first.payment.recorded_by);
    assert_eq!(second.payment.amount, 100.0);
    assert_eq!(second.summary.amount_paid, 100.0);
    assert_eq!(second.summary.balance_due, 0.0);
    assert_eq!(second.summary.payment_status, "paid");
    let after: i64 = sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
        .bind(invoice)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(revision, after);
    let hash: Vec<u8> = sqlx::query_scalar("SELECT request_hash FROM invoice_payments WHERE id=$1")
        .bind(first.payment.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        hash,
        crate::idempotency::request_hash("invoice.payment.v1", invoice, &input)
    );
    let detail = service::get_invoice(&state, invoice).await.unwrap();
    assert_eq!(detail.payments.len(), 1);
    assert_eq!(detail.payments[0].recorded_by.as_deref(), Some("staff"));
    assert_eq!(detail.totals.total, 100.0);
}

#[sqlx::test]
async fn changed_payment_retries_conflict_even_when_the_balance_allows_more(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let input = payment(20.0);
    service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    for changed in [
        RecordPaymentInput {
            amount: 30.0,
            ..input
        },
        RecordPaymentInput {
            payment_type: PaymentType::Card,
            ..input
        },
        RecordPaymentInput {
            order_id: Some(orders[0]),
            ..input
        },
    ] {
        assert!(matches!(
            service::record_payment(&state, invoice, changed, "staff").await,
            Err(AppError::Conflict(_))
        ));
    }
    assert_eq!(
        service::get_invoice(&state, invoice)
            .await
            .unwrap()
            .payments
            .len(),
        1
    );
}

#[sqlx::test]
async fn concurrent_payment_retries_record_one_payment(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let input = payment(25.0);
    let (first, second) = tokio::join!(
        service::record_payment(&state, invoice, input, "staff"),
        service::record_payment(&state, invoice, input, "staff")
    );
    assert_eq!(first.unwrap().payment.id, second.unwrap().payment.id);
    let detail = service::get_invoice(&state, invoice).await.unwrap();
    assert_eq!(detail.payments.len(), 1);
    assert_eq!(detail.totals.amount_paid, 25.0);
    assert_eq!(detail.totals.balance_due, 75.0);
}

#[sqlx::test]
async fn failed_payment_does_not_reserve_its_id_and_new_ids_allow_new_payments(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let mut input = payment(101.0);
    assert!(matches!(
        service::record_payment(&state, invoice, input, "staff").await,
        Err(AppError::BadRequest(_))
    ));
    input.amount = 20.0;
    service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    input.request_id = Uuid::new_v4();
    let second = service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    assert_eq!(second.summary.amount_paid, 40.0);
    assert_eq!(
        service::get_invoice(&state, invoice)
            .await
            .unwrap()
            .payments
            .len(),
        2
    );
}

#[sqlx::test]
async fn payment_replay_returns_current_summary_even_after_its_order_closes(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let input = RecordPaymentInput {
        order_id: Some(orders[0]),
        ..payment(20.0)
    };
    let first = service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    service::record_payment(&state, invoice, payment(30.0), "staff")
        .await
        .unwrap();
    crate::features::returns::service::cancel_order(
        &state,
        orders[0],
        serde_json::from_value(serde_json::json!({
            "requestId":Uuid::new_v4(),"reason":"Changed plans","refund":{"timing":"later"}
        }))
        .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let replay = service::record_payment(&state, invoice, input, "staff")
        .await
        .unwrap();
    assert_eq!(replay.payment.id, first.payment.id);
    assert_eq!(replay.payment.amount, 20.0);
    assert_eq!(replay.summary.amount_paid, 50.0);
    assert_eq!(replay.summary.balance_due, 0.0);
    assert_eq!(replay.summary.payment_status, "paid");
    assert_eq!(
        service::get_invoice(&state, invoice)
            .await
            .unwrap()
            .payments
            .len(),
        2
    );
}
