use chrono::{NaiveDate, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{day_service, missed_service, service, till_service, types::*};
use crate::{
    error::AppError,
    features::invoices::{service as invoices, types::PaymentType},
    test_support,
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
fn counts() -> ClosingCounts {
    serde_json::from_value::<ClosingCounts>(serde_json::json!({
        "branchActivityConfirmed": true,
        "openingCash": 50.0,
        "cashAdded": 0.0,
        "cashRemoved": 0.0,
        "actualCash": 45.0,
        "actualBenefit": 0.0,
        "actualCard": 0.0,
        "notes": "",
    }))
    .unwrap()
}

#[sqlx::test]
async fn first_opening_starts_tracking_and_old_history_never_becomes_a_backlog(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let old = today().pred_opt().unwrap();
    let when = service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(when)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at) VALUES($1,20,'cash',$2)").bind(invoice).bind(when).execute(&pool).await.unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(
        status.tracking_start_date.is_none()
            && !status.can_create_orders
            && status.previous_unclosed_date.is_none()
    );
    let payment =
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
            .unwrap();
    assert!(matches!(
        invoices::record_payment(&state, invoice, payment, "staff").await,
        Err(AppError::Conflict(_))
    ));
    let initial = opening(branch, today());
    let saved = till_service::save_opening(&state, initial.clone(), None, "opener")
        .await
        .unwrap();
    assert_eq!(saved.recorded_by, "opener");
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(status.can_create_orders && status.previous_unclosed_date.is_none());
    assert_eq!(status.tracking_start_date, Some(today()));
    let payment =
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
            .unwrap();
    invoices::record_payment(&state, invoice, payment, "staff")
        .await
        .unwrap();
    let legacy = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert!(
        legacy.read_only
            && legacy.opening.is_none()
            && legacy.closure.is_none()
            && legacy.missed_closing.is_none()
    );
    assert_eq!(legacy.summary.invoice_total, 100.0);
    assert_eq!(legacy.summary.invoice_payments, 20.0);
    let current = service::sales_closing(&state, Some(today()), branch)
        .await
        .unwrap();
    let mut actual = counts();
    actual.actual_cash = 55.0;
    assert!(
        super::reconciliation::compare(&current, &actual)
            .unwrap()
            .matched
    );
    let mut corrected = opening(branch, today());
    corrected.amount = 55.0;
    corrected.notes = "Corrected the opening float after recount.".into();
    till_service::save_opening(&state, corrected, Some(saved.id), "manager")
        .await
        .unwrap();
    let restarted = test_support::state_without_openings(pool.clone(), None, None).await;
    assert_eq!(
        day_service::status(&restarted, branch)
            .await
            .unwrap()
            .tracking_start_date,
        Some(today())
    );
    assert_eq!(
        till_service::save_opening(&restarted, initial, None, "opener")
            .await
            .unwrap()
            .id,
        saved.id
    );
    let other: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Not opened yet') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let other_status = day_service::status(&restarted, other).await.unwrap();
    assert!(other_status.tracking_start_date.is_none() && !other_status.can_create_orders);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_day_closures")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test]
async fn first_opening_cannot_double_count_receipts_or_be_backdated(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,10,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    assert!(
        matches!(till_service::save_opening(&state, opening(branch,today()),None,"staff").await,
        Err(AppError::Conflict(message)) if message.contains("counted twice"))
    );
    assert!(day_service::status(&state, branch)
        .await
        .unwrap()
        .tracking_start_date
        .is_none());
    assert!(matches!(
        till_service::save_opening(
            &state,
            opening(branch, today().pred_opt().unwrap()),
            None,
            "staff"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::save_opening(
            &state,
            opening(branch, today().succ_opt().unwrap()),
            None,
            "staff"
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_cash_openings")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test]
async fn simultaneous_first_openings_establish_only_one_baseline(pool: PgPool) {
    let branch: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('First opening race') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let a = opening(branch, today());
    let mut b = opening(branch, today());
    b.amount = 40.0;
    let (a, b) = tokio::join!(
        till_service::save_opening(&state, a, None, "one"),
        till_service::save_opening(&state, b, None, "two")
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_cash_openings")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .tracking_start_date,
        Some(today())
    );
}

#[sqlx::test]
async fn past_financial_writes_are_rejected_and_manager_resolutions_cannot_change_figures(
    pool: PgPool,
) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let old = today().pred_opt().unwrap();
    let timestamp = service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(timestamp)
        .execute(&pool)
        .await
        .unwrap();
    let opening_id: Uuid=sqlx::query_scalar("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex')) RETURNING id").bind(branch).bind(old).fetch_one(&pool).await.unwrap();
    let expense_id: Uuid=sqlx::query_scalar("INSERT INTO branch_expenses(branch_id,business_date,amount,payment_type,reason,recorded_by,request_id,request_hash) VALUES($1,$2,5,'cash','Delivery','fixture',uuidv7(),decode(repeat('00',32),'hex')) RETURNING id").bind(branch).bind(old).fetch_one(&pool).await.unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let report = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert!(report.read_only);
    assert_eq!(report.late_closing_date, Some(old));
    let input = serde_json::from_value::<CloseDayInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": old,
        "fingerprint": report.fingerprint.clone(),
        "counts": counts(),
    }))
    .unwrap();
    assert!(matches!(
        day_service::close_day(&state, input.clone(), "staff").await,
        Err(AppError::BadRequest(message)) if message.contains("closed late")
    ));
    let mut correction = opening(branch, old);
    correction.notes = "Attempted correction".into();
    assert!(matches!(
        till_service::save_opening(&state, correction, Some(opening_id), "manager").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::record_expense(
            &state,
            serde_json::from_value::<RecordExpenseInput>(serde_json::json!({
                "requestId": Uuid::new_v4(),
                "branchId": branch,
                "date": old,
                "amount": 1.0,
                "paymentType": PaymentType::Cash,
                "reason": "Late fee",
                "paidTo": "",
                "reference": "",
            }))
            .unwrap(),
            "staff"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::void_expense(
            &state,
            expense_id,
            serde_json::from_value::<VoidExpenseInput>(serde_json::json!({
                "requestId": Uuid::new_v4(),
                "reason": "Attempted void",
            }))
            .unwrap(),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    let resolution = serde_json::from_value::<ResolveMissedClosingInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": old,
        "reason": "Closing was missed; physical counts are unavailable.",
    }))
    .unwrap();
    let (a, b) = tokio::join!(
        missed_service::resolve_missed(&state, resolution.clone(), "manager"),
        missed_service::resolve_missed(&state, resolution, "manager")
    );
    assert_eq!(
        a.as_ref().unwrap().missed_closing.as_ref().unwrap().id,
        b.unwrap().missed_closing.unwrap().id
    );
    let frozen = a.unwrap();
    assert_eq!(frozen.fingerprint, report.fingerprint);
    assert_eq!(frozen.opening.unwrap().amount, 50.0);
    assert_eq!(frozen.expenses[0].amount, 5.0);
    assert!(frozen.closure.is_none());
    assert!(matches!(
        day_service::close_day(&state, input, "manager").await,
        Err(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn an_existing_closed_historical_day_has_no_manager_reopen_path(pool: PgPool) {
    use super::{day_repository, reconciliation};
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let old = today().pred_opt().unwrap();
    let timestamp = service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(timestamp)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(old).execute(&pool).await.unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let report = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    let mut counts = counts();
    counts.actual_cash = 50.0;
    let input = serde_json::from_value::<CloseDayInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": old,
        "fingerprint": report.fingerprint.clone(),
        "counts": counts,
    }))
    .unwrap();
    let comparison = reconciliation::compare(&report, &input.counts).unwrap();
    // This fixture represents a report finalized on time before today's date.
    let mut tx = pool.begin().await.unwrap();
    day_repository::insert_closure(&mut tx, &input, &comparison, &report, &[0; 32], "fixture")
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(matches!(
        missed_service::resolve_missed(
            &state,
            serde_json::from_value::<ResolveMissedClosingInput>(serde_json::json!({
                "requestId": Uuid::new_v4(),
                "branchId": branch,
                "date": old,
                "reason": "Try reopening",
            }))
            .unwrap(),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        day_service::close_day(&state, input, "manager").await,
        Err(AppError::Conflict(_))
    ));
    let frozen = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert!(frozen.read_only && frozen.closure.is_some() && frozen.missed_closing.is_none());
    assert_eq!(frozen.fingerprint, report.fingerprint);
}

#[sqlx::test]
async fn disabling_the_check_is_branch_scoped_and_does_not_reset_history(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let old = today().pred_opt().unwrap();
    let when = service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(when)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(old).execute(&pool).await.unwrap();
    let other: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name) VALUES('Still requires opening') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let before = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    let enabled = day_service::status(&state, branch).await.unwrap();
    assert!(enabled.daily_check_required && !enabled.can_trade);
    let disabled = day_service::set_daily_check(
        &state,
        serde_json::from_value(json!({"branchId":branch,"required":false})).unwrap(),
        "manager-one",
    )
    .await
    .unwrap();
    assert!(!disabled.daily_check_required && disabled.can_trade && !disabled.opening_recorded);
    assert_eq!(disabled.tracking_start_date, Some(old));
    assert_eq!(
        disabled.daily_check_changed_by.as_deref(),
        Some("manager-one")
    );
    let retry = day_service::set_daily_check(
        &state,
        serde_json::from_value(json!({"branchId":branch,"required":false})).unwrap(),
        "manager-two",
    )
    .await
    .unwrap();
    assert_eq!(
        retry.daily_check_changed_at,
        disabled.daily_check_changed_at
    );
    assert_eq!(
        retry.daily_check_changed_by,
        disabled.daily_check_changed_by
    );
    let other_status = day_service::status(&state, other).await.unwrap();
    assert!(other_status.daily_check_required && !other_status.can_trade);
    invoices::record_payment(
        &state,
        invoice,
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
            .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    invoices::create_invoice(&state,serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":10,"recipientPhone":"33112233"}]})).unwrap(),"staff").await.unwrap();
    let after = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert!(after.read_only && after.closure.is_none());
    let skipped = after.missed_closing.as_ref().unwrap();
    assert!(skipped.reason.contains("Automatically skipped"));
    assert_eq!(skipped.resolved_by, "manager-one");
    assert_eq!(after.fingerprint, before.fingerprint);
    invoices::update_invoice(&state,invoice,serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":10,"recipientPhone":"33112233"}]})).unwrap()).await.unwrap();
    let after_edit = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert_eq!(after_edit.fingerprint, before.fingerprint);
    assert_eq!(after_edit.missed_closing.as_ref().unwrap().id, skipped.id);
    let restored = day_service::set_daily_check(
        &state,
        serde_json::from_value(json!({"branchId":branch,"required":true})).unwrap(),
        "manager",
    )
    .await
    .unwrap();
    assert!(restored.daily_check_required && !restored.can_trade);
    assert_eq!(restored.previous_unclosed_date, None);
    assert_eq!(restored.tracking_start_date, Some(old));
    assert!(matches!(missed_service::resolve_missed(&state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":old,"reason":"Try replacing the automatic skip."})).unwrap(),"manager").await,Err(AppError::Conflict(_))));
    assert!(
        matches!(till_service::save_opening(&state,opening(branch,today()),None,"staff").await,Err(AppError::Conflict(message)) if message.contains("counted twice"))
    );
}
