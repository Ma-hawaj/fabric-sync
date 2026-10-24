use super::{
    service,
    types::{PaymentType, RecordPaymentInput},
};
use crate::test_support;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test]
async fn record_payment_returns_exact_stored_cents(db: PgPool) {
    let (invoice_id, _, _, _) = test_support::invoice(&db, 1, false).await;
    let state = test_support::state(db.clone(), None, None).await;

    for (submitted, stored, total_paid, remaining) in [
        (0.1, 0.1, 0.1, 99.9),
        (0.2, 0.2, 0.3, 99.7),
        (0.005, 0.01, 0.31, 99.69),
    ] {
        let result = service::record_payment(
            &state,
            invoice_id,
            RecordPaymentInput {
                request_id: Uuid::new_v4(),
                amount: submitted,
                payment_type: PaymentType::Cash,
                order_id: None,
            },
            "staff",
        )
        .await
        .unwrap();

        let ledger_total: f64 = sqlx::query_scalar(
            "SELECT SUM(amount)::float8 FROM invoice_payments WHERE invoice_id=$1",
        )
        .bind(invoice_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(result.payment.amount, stored);
        assert_eq!(result.summary.amount_paid, total_paid);
        assert_eq!(result.summary.amount_paid, ledger_total);
        assert_eq!(result.summary.balance_due, remaining);
        assert_eq!(result.summary.payment_status, "partial");
    }
}

#[sqlx::test]
async fn collect_invoice_returns_exact_stored_cents(db: PgPool) {
    let (invoice_id, _, _, _) = test_support::invoice(&db, 1, false).await;
    sqlx::query("UPDATE invoices SET total_price=0.3 WHERE id=$1")
        .bind(invoice_id)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET price=0.3 WHERE invoice_id=$1")
        .bind(invoice_id)
        .execute(&db)
        .await
        .unwrap();
    let state = test_support::state(db.clone(), None, None).await;
    service::record_payment(
        &state,
        invoice_id,
        RecordPaymentInput {
            request_id: Uuid::new_v4(),
            amount: 0.1,
            payment_type: PaymentType::Cash,
            order_id: None,
        },
        "staff",
    )
    .await
    .unwrap();

    let result = service::collect_invoice(&state, invoice_id, Some(PaymentType::Card), "staff")
        .await
        .unwrap();
    let detail = service::get_invoice(&state, invoice_id).await.unwrap();
    assert_eq!(result.amount_paid, 0.3);
    assert_eq!(result.amount_paid, detail.totals.amount_paid);
    assert_eq!(result.balance_due, 0.0);
    assert_eq!(result.payment_status, "paid");
    assert!(result.collected);
    assert_eq!(detail.totals.total, 0.3);
    assert_eq!(detail.payments.len(), 2);
    assert_eq!(detail.payments[1].amount, 0.2);
}
