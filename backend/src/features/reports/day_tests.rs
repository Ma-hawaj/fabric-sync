use chrono::{NaiveDate, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{day_service, service, till_service, types::*};
use crate::{
    error::AppError,
    features::invoices::{
        service as invoices,
        types::{CreateInvoiceInput, PaymentType, RecordPaymentInput},
    },
    state::AppState,
};

fn today() -> NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive()
}
fn opening(branch: Uuid, date: NaiveDate) -> SaveOpeningInput {
    serde_json::from_value::<SaveOpeningInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": date,
        "amount": 50.0,
        "notes": "",
    }))
    .unwrap()
}
fn sale(branch: Uuid) -> CreateInvoiceInput {
    serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":10,"recipientPhone":"33112233"}]})).unwrap()
}
fn payment() -> RecordPaymentInput {
    serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
        .unwrap()
}
async fn check(state: &AppState, branch: Uuid, date: NaiveDate, shortage: bool) -> CloseDayInput {
    let report = service::sales_closing(state, Some(date), branch)
        .await
        .unwrap();
    let net = |method| {
        report
            .tenders
            .iter()
            .find(|t| t.method == method)
            .unwrap()
            .net
    };
    let actual_cash = report.opening.as_ref().unwrap().amount + net("cash")
        - report
            .tenders
            .iter()
            .find(|t| t.method == "cash")
            .unwrap()
            .expenses
        - if shortage { 2.0 } else { 0.0 };
    serde_json::from_value(json!({
        "requestId": Uuid::new_v4(), "branchId": branch, "date": date,
        "fingerprint": report.fingerprint,
        "counts": {
            "branchActivityConfirmed": true,
            "openingCash": report.opening.as_ref().unwrap().amount,
            "cashAdded": 0, "cashRemoved": 0,
            "actualCash": actual_cash, "actualBenefit": net("benefit"), "actualCard": net("card"),
            "notes": if shortage { "Drawer is two dinars short after recount; manager informed." } else { "" }
        }
    })).unwrap()
}

#[sqlx::test]
async fn opening_is_required_and_explained_final_close_locks_every_financial_entry(pool: PgPool) {
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(!status.opening_recorded && !status.can_create_orders);
    assert!(matches!(
        invoices::create_invoice(&state, sale(branch), "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        invoices::record_payment(&state, invoice, payment(), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let initial = opening(branch, today());
    let saved_opening = till_service::save_opening(&state, initial.clone(), None, "opener")
        .await
        .unwrap();
    assert!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .can_create_orders
    );
    let request = payment();
    let fee = till_service::record_expense(
        &state,
        serde_json::from_value::<RecordExpenseInput>(serde_json::json!({
            "requestId": Uuid::new_v4(),
            "branchId": branch,
            "date": today(),
            "amount": 5.0,
            "paymentType": PaymentType::Cash,
            "reason": "Delivery",
            "paidTo": "",
            "reference": "",
        }))
        .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let receipt = invoices::record_payment(&state, invoice, request.clone(), "staff")
        .await
        .unwrap();
    let close = check(&state, branch, today(), true).await;
    let report = day_service::close_day(&state, close.clone(), "closer")
        .await
        .unwrap();
    assert_eq!(report.closure.as_ref().unwrap().closed_by, "closer");
    assert_eq!(
        report.last_check.as_ref().unwrap().comparison.lines[0].difference,
        -2.0
    );
    assert!(!report.last_check.as_ref().unwrap().comparison.matched);
    assert_eq!(
        day_service::close_day(&state, close.clone(), "closer")
            .await
            .unwrap()
            .closure
            .unwrap()
            .id,
        report.closure.unwrap().id
    );
    assert!(
        !day_service::status(&state, branch)
            .await
            .unwrap()
            .can_create_orders
    );
    let mut new_check = close;
    new_check.request_id = Uuid::new_v4();
    assert!(matches!(
        day_service::close_day(&state, new_check, "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::void_expense(
            &state,
            fee.id,
            serde_json::from_value::<VoidExpenseInput>(serde_json::json!({
                "requestId": Uuid::new_v4(),
                "reason": "Wrong fee",
            }))
            .unwrap(),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        invoices::create_invoice(&state, sale(branch), "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        invoices::record_payment(&state, invoice, payment(), "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        invoices::record_payment(&state, invoice, request, "staff")
            .await
            .unwrap()
            .payment
            .id,
        receipt.payment.id
    );
    let mut correction = initial.clone();
    correction.request_id = Uuid::new_v4();
    correction.notes = "Recount".into();
    assert!(matches!(
        till_service::save_opening(&state, correction, Some(saved_opening.id), "manager").await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        till_service::save_opening(&state, initial, None, "opener")
            .await
            .unwrap()
            .id,
        saved_opening.id
    );
    let expense = serde_json::from_value::<RecordExpenseInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": today(),
        "amount": 5.0,
        "paymentType": PaymentType::Cash,
        "reason": "Delivery",
        "paidTo": "",
        "reference": "",
    }))
    .unwrap();
    assert!(matches!(
        till_service::record_expense(&state, expense, "staff").await,
        Err(AppError::Conflict(_))
    ));
    // Even a later direct legacy change cannot replace a finalized snapshot.
    sqlx::query("UPDATE invoices SET total_price=99 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let frozen = service::sales_closing(&state, Some(today()), branch)
        .await
        .unwrap();
    assert_eq!(frozen.summary.invoice_total, 100.0);
    assert_eq!(frozen.last_check.unwrap().counts.actual_cash, 48.0);
}

#[sqlx::test]
async fn missed_days_stay_read_only_and_separate_resolutions_unblock_only_their_branch(
    pool: PgPool,
) {
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let earlier = today().checked_sub_days(chrono::Days::new(3)).unwrap();
    let when = super::service::day_bounds(earlier, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0
        + chrono::Duration::hours(9);
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(when)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_closing_policies(branch_id,starts_on,configured_by,request_id,request_hash) VALUES($1,$2,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(earlier).execute(&pool).await.unwrap();
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    assert_eq!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .previous_unclosed_date,
        Some(earlier)
    );
    assert!(matches!(
        till_service::save_opening(&state, opening(branch, today()), None, "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::save_opening(&state, opening(branch, earlier), None, "staff").await,
        Err(AppError::Conflict(_))
    ));
    let other = crate::test_support::trading_branch(&pool).await;
    assert!(
        day_service::status(&state, other)
            .await
            .unwrap()
            .can_create_orders
    );
    let before = service::sales_closing(&state, Some(earlier), branch)
        .await
        .unwrap();
    assert!(before.read_only);
    let resolution = serde_json::from_value::<ResolveMissedClosingInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": earlier,
        "reason": "Staff missed the count. No historical physical balance is being supplied.",
    }))
    .unwrap();
    let resolved = super::rollout_service::resolve_missed(&state, resolution.clone(), "manager")
        .await
        .unwrap();
    assert!(resolved.read_only && resolved.closure.is_none() && resolved.last_check.is_none());
    assert_eq!(resolved.fingerprint, before.fingerprint);
    assert_eq!(
        resolved.missed_closing.as_ref().unwrap().resolved_by,
        "manager"
    );
    assert_eq!(
        super::rollout_service::resolve_missed(&state, resolution.clone(), "manager")
            .await
            .unwrap()
            .missed_closing
            .unwrap()
            .id,
        resolved.missed_closing.unwrap().id
    );
    let mut changed = resolution;
    changed.request_id = Uuid::new_v4();
    changed.reason = "Try to replace the explanation".into();
    assert!(matches!(
        super::rollout_service::resolve_missed(&state, changed, "manager").await,
        Err(AppError::Conflict(_))
    ));
    till_service::save_opening(&state, opening(branch, today()), None, "staff")
        .await
        .unwrap();
    assert!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .can_create_orders
    );
    assert!(matches!(
        invoices::update_invoice(&state, invoice, sale(branch)).await,
        Err(AppError::Conflict(_))
    ));
    invoices::record_payment(&state, invoice, payment(), "staff")
        .await
        .unwrap();
    sqlx::query("UPDATE invoices SET total_price=99 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let frozen = service::sales_closing(&state, Some(earlier), branch)
        .await
        .unwrap();
    assert_eq!(frozen.summary.invoice_total, 100.0);
    assert_eq!(frozen.summary.invoice_payments, 0.0);
    assert_eq!(
        service::sales_closing(&state, Some(today()), branch)
            .await
            .unwrap()
            .summary
            .invoice_payments,
        5.0
    );
}

#[sqlx::test]
async fn closing_and_payments_serialize_and_stale_checks_cannot_be_finalized(pool: PgPool) {
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    till_service::save_opening(&state, opening(branch, today()), None, "staff")
        .await
        .unwrap();
    let stale_close = check(&state, branch, today(), false).await;
    invoices::record_payment(&state, invoice, payment(), "staff")
        .await
        .unwrap();
    assert!(matches!(
        day_service::close_day(&state, stale_close, "staff").await,
        Err(AppError::Conflict(_))
    ));
    let close = check(&state, branch, today(), false).await;
    let (closing, payment) = tokio::join!(
        day_service::close_day(&state, close, "staff"),
        invoices::record_payment(&state, invoice, payment(), "staff")
    );
    assert_ne!(
        closing.is_ok(),
        payment.is_ok(),
        "either the close commits or the payment commits, never both"
    );
    assert!(matches!(
        closing.as_ref().err().or(payment.as_ref().err()),
        Some(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn unresolved_activity_requires_an_explanation_to_finalize(pool: PgPool) {
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    till_service::save_opening(&state, opening(branch, today()), None, "staff")
        .await
        .unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount) VALUES($1,1)")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let mut close = check(&state, branch, today(), false).await;
    assert!(matches!(
        day_service::close_day(&state, close.clone(), "staff").await,
        Err(AppError::BadRequest(_))
    ));
    close.counts.notes = "One imported receipt has no method; manager is investigating.".into();
    let closed = day_service::close_day(&state, close, "staff")
        .await
        .unwrap();
    assert!(!closed.last_check.as_ref().unwrap().comparison.matched);
    assert_eq!(closed.summary.unrecorded_method_count, 1);
}

#[sqlx::test]
async fn issuing_branch_owns_financial_activity_independently_of_pickup(pool: PgPool) {
    let (_, _, _, pickup) = crate::test_support::invoice(&pool, 1, false).await;
    let issuer: Uuid = sqlx::query_scalar("INSERT INTO branch(name,receives_orders,holds_stock,produces_orders) VALUES('Issuing desk',false,false,true) RETURNING id")
        .fetch_one(&pool).await.unwrap();
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    till_service::save_opening(&state, opening(issuer, today()), None, "staff")
        .await
        .unwrap();
    let mut input = sale(issuer);
    input.branch_id = Some(pickup);
    let created = invoices::create_invoice(&state, input.clone(), "staff")
        .await
        .unwrap();
    // A pickup-only change cannot move sales, funding VAT or till ownership.
    input.branch_id = None;
    invoices::update_invoice(&state, created.id, input)
        .await
        .unwrap();
    let report = service::sales_closing(&state, Some(today()), issuer)
        .await
        .unwrap();
    assert_eq!(report.summary.invoice_count, 1);
    assert_eq!(report.summary.gift_card_sales, 10.0);
    assert_eq!(report.summary.taxable_amount, 9.09);
    assert_eq!(report.summary.vat_amount, 0.91);
    let collection = service::sales_closing(&state, Some(today()), pickup)
        .await
        .unwrap();
    assert_eq!(collection.summary.invoice_total, 100.0);
    let close = check(&state, issuer, today(), false).await;
    day_service::close_day(&state, close, "staff")
        .await
        .unwrap();
    assert!(matches!(
        invoices::create_invoice(&state, sale(issuer), "staff").await,
        Err(AppError::Conflict(_))
    ));
    till_service::save_opening(&state, opening(pickup, today()), None, "staff")
        .await
        .unwrap();
    assert!(
        day_service::status(&state, pickup)
            .await
            .unwrap()
            .can_create_orders
    );
    invoices::create_invoice(&state, sale(pickup), "staff")
        .await
        .unwrap();
}

#[sqlx::test]
async fn retiring_a_branch_blocks_new_invoices_but_allows_current_day_edits(pool: PgPool) {
    let branch = crate::test_support::trading_branch(&pool).await;
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let input = sale(branch);
    let invoice = invoices::create_invoice(&state, input.clone(), "staff")
        .await
        .unwrap();
    sqlx::query("UPDATE branch SET is_active=false WHERE id=$1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(status.can_trade && !status.can_create_orders);
    invoices::update_invoice(&state, invoice.id, input.clone())
        .await
        .unwrap();
    assert!(matches!(
        invoices::create_invoice(&state, input, "staff").await,
        Err(AppError::BadRequest(message)) if message.contains("issuing branch")
    ));
}
