use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use super::{reconciliation, service, till_service, types::*};
use crate::{error::AppError, features::invoices::types::PaymentType};

fn day() -> NaiveDate {
    chrono::Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive()
}
fn opening(branch: Uuid) -> SaveOpeningInput {
    serde_json::from_value::<SaveOpeningInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": day(),
        "amount": 50.0,
        "notes": "",
    }))
    .unwrap()
}
fn expense(branch: Uuid, amount: f64, payment_type: PaymentType) -> RecordExpenseInput {
    serde_json::from_value::<RecordExpenseInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": day(),
        "amount": amount,
        "paymentType": payment_type,
        "reason": "Delivery fee",
        "paidTo": "Local courier",
        "reference": "D-100",
    }))
    .unwrap()
}
fn counts(cash: f64) -> ClosingCounts {
    serde_json::from_value::<ClosingCounts>(serde_json::json!({
        "branchActivityConfirmed": true,
        "openingCash": 50.0,
        "cashAdded": 0.0,
        "cashRemoved": 0.0,
        "actualCash": cash,
        "actualBenefit": 20.0,
        "actualCard": 0.0,
        "notes": "",
    }))
    .unwrap()
}

#[sqlx::test]
async fn delivery_expenses_reduce_drawer_cash_once_and_preserve_an_audit_trail(pool: PgPool) {
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    let before = service::sales_closing(&state, Some(day()), branch)
        .await
        .unwrap();
    assert!(matches!(
        reconciliation::compare(&before, &counts(130.0)),
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        till_service::record_expense(&state, expense(branch, 5.0, PaymentType::Cash), "staff")
            .await,
        Err(AppError::Conflict(_))
    ));

    let opening_input = opening(branch);
    let saved_opening =
        till_service::save_opening(&state, opening_input.clone(), None, "opening-staff")
            .await
            .unwrap();
    assert_eq!(
        till_service::save_opening(&state, opening_input.clone(), None, "opening-staff")
            .await
            .unwrap()
            .id,
        saved_opening.id
    );
    let mut changed = opening_input;
    changed.amount = 100.0;
    assert!(matches!(
        till_service::save_opening(&state, changed, None, "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::save_opening(&state, opening(branch), None, "staff").await,
        Err(AppError::Conflict(_))
    ));

    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,80,'cash'),($1,20,'benefit')").bind(invoice).execute(&pool).await.unwrap();
    let delivery = expense(branch, 5.005, PaymentType::Cash);
    let paid = till_service::record_expense(&state, delivery.clone(), "expense-staff")
        .await
        .unwrap();
    assert_eq!(paid.recorded_by, "expense-staff");
    assert_eq!(paid.reference, "D-100");
    let retry = till_service::record_expense(&state, delivery.clone(), "expense-staff")
        .await
        .unwrap();
    assert_eq!(retry.id, paid.id);
    let mut changed = delivery;
    changed.amount = 6.0;
    assert!(matches!(
        till_service::record_expense(&state, changed, "staff").await,
        Err(AppError::Conflict(_))
    ));
    till_service::record_expense(&state, expense(branch, 3.0, PaymentType::Card), "staff")
        .await
        .unwrap();
    till_service::record_expense(&state, expense(branch, 2.0, PaymentType::Benefit), "staff")
        .await
        .unwrap();

    let report = service::sales_closing(&state, Some(day()), branch)
        .await
        .unwrap();
    assert_eq!(report.expenses.len(), 3);
    assert_eq!(report.tenders[0].expenses, 5.005);
    assert_eq!(report.tenders[0].after_expenses, 74.995);
    let compared = reconciliation::compare(&report, &counts(124.995)).unwrap();
    assert!(compared.matched);
    assert_eq!(compared.lines[0].expected, 124.995);
    assert_eq!(compared.lines[1].expected, 20.0); // outgoing Benefit expense is not a negative terminal receipt
    assert_eq!(compared.lines[2].expected, 0.0);
    let mut tampered = counts(124.995);
    tampered.opening_cash = 60.0;
    assert!(matches!(
        reconciliation::compare(&report, &tampered),
        Err(AppError::Conflict(_))
    ));
    let void = serde_json::from_value::<VoidExpenseInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "reason": "Courier returned the money; duplicate booking",
    }))
    .unwrap();
    let voided = till_service::void_expense(&state, paid.id, void.clone(), "manager")
        .await
        .unwrap();
    assert!(voided.voided_at.is_some());
    assert_eq!(voided.voided_by.as_deref(), Some("manager"));
    assert_eq!(
        till_service::void_expense(&state, paid.id, void, "manager")
            .await
            .unwrap()
            .id,
        paid.id
    );
    let after_void = service::sales_closing(&state, Some(day()), branch)
        .await
        .unwrap();
    assert_eq!(after_void.expenses.len(), 3);
    assert_eq!(after_void.tenders[0].expenses, 0.0);
    assert_ne!(after_void.fingerprint, report.fingerprint);
    assert!(
        reconciliation::compare(&after_void, &counts(130.0))
            .unwrap()
            .matched
    );

    let mut corrected = opening(branch);
    corrected.amount = 45.0;
    corrected.notes = "Recounted opening float; original entry was five dinars high".into();
    let correction =
        till_service::save_opening(&state, corrected.clone(), Some(saved_opening.id), "manager")
            .await
            .unwrap();
    assert_eq!(correction.supersedes_id, Some(saved_opening.id));
    assert_eq!(
        till_service::save_opening(&state, corrected, Some(saved_opening.id), "manager")
            .await
            .unwrap()
            .id,
        correction.id
    );
    let after_correction = service::sales_closing(&state, Some(day()), branch)
        .await
        .unwrap();
    assert_eq!(after_correction.opening.unwrap().amount, 45.0);
    assert_ne!(after_correction.fingerprint, after_void.fingerprint);
    let originals: Vec<f64> =
        sqlx::query_scalar("SELECT amount::float8 FROM branch_cash_openings ORDER BY recorded_at")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(originals, vec![50.0, 45.0]);

    let other: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Other expense branch') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let other_report = service::sales_closing(&state, Some(day()), other)
        .await
        .unwrap();
    assert!(other_report.expenses.is_empty());
    assert!(other_report.opening.is_none());
    let previous_day = service::sales_closing(&state, Some(day().pred_opt().unwrap()), branch)
        .await
        .unwrap();
    assert!(previous_day.expenses.is_empty());
    assert!(previous_day.opening.is_none());
}

#[sqlx::test]
async fn expense_retries_serialize_and_invalid_inputs_never_reach_the_ledger(pool: PgPool) {
    let (_, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    till_service::save_opening(&state, opening(branch), None, "staff")
        .await
        .unwrap();
    let input = expense(branch, 0.001, PaymentType::Cash);
    let (a, b) = tokio::join!(
        till_service::record_expense(&state, input.clone(), "staff"),
        till_service::record_expense(&state, input, "staff")
    );
    assert_eq!(a.unwrap().id, b.unwrap().id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_expenses")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    for amount in [0.0, -1.0, 0.0001, f64::NAN, f64::INFINITY] {
        let mut invalid = expense(branch, 1.0, PaymentType::Cash);
        // Nonfinite values cannot be expressed in JSON; also check the service boundary.
        invalid.amount = amount;
        assert!(matches!(
            till_service::record_expense(&state, invalid, "staff").await,
            Err(AppError::BadRequest(_))
        ));
    }
    let mut blank = expense(branch, 2.0, PaymentType::Cash);
    blank.reason = "  ".into();
    assert!(matches!(
        till_service::record_expense(&state, blank, "staff").await,
        Err(AppError::BadRequest(_))
    ));
    let mut future = expense(branch, 2.0, PaymentType::Cash);
    future.date = "9999-01-01".parse().unwrap();
    assert!(matches!(
        till_service::record_expense(&state, future, "staff").await,
        Err(AppError::BadRequest(_))
    ));
}
