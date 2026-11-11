use chrono::{NaiveDate, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{day_service, rollout_service, service, till_service, types::*};
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
fn setup(branch: Uuid, starts_on: NaiveDate) -> ConfigureClosingInput {
    serde_json::from_value::<ConfigureClosingInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "startsOn": starts_on,
    }))
    .unwrap()
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
async fn first_rollout_ignores_legacy_history_without_fabricating_a_closing(pool: PgPool) {
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
    let state = test_support::state_without_closing_setup(pool.clone(), None, None).await;
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(
        status.setup_required
            && !status.can_create_orders
            && status.previous_unclosed_date.is_none()
    );
    let input = setup(branch, today());
    let policy = rollout_service::configure(&state, input.clone(), "manager")
        .await
        .unwrap();
    assert_eq!(policy.configured_by, "manager");
    till_service::save_opening(&state, opening(branch, today()), None, "staff")
        .await
        .unwrap();
    invoices::create_invoice(&state,serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":10,"recipientPhone":"33112233"}]})).unwrap(),"staff").await.unwrap();
    assert!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .can_create_orders
    );
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
    assert_eq!(
        rollout_service::configure(&state, input, "manager")
            .await
            .unwrap()
            .configured_at,
        policy.configured_at
    );
    assert!(matches!(
        rollout_service::configure(
            &state,
            setup(branch, today().succ_opt().unwrap()),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_day_closures")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test]
async fn a_midday_rollout_requires_a_future_date_and_preserves_current_trading(pool: PgPool) {
    let (_, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let state = test_support::state_without_closing_setup(pool.clone(), None, None).await;
    assert!(matches!(
        rollout_service::configure(&state, setup(branch, today()), "manager").await,
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        rollout_service::configure(
            &state,
            setup(branch, today().pred_opt().unwrap()),
            "manager"
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    let tomorrow = today().succ_opt().unwrap();
    rollout_service::configure(&state, setup(branch, tomorrow), "manager")
        .await
        .unwrap();
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(status.can_create_orders && !status.opening_recorded && !status.setup_required);
    assert_eq!(status.controls_start_date, Some(tomorrow));
    invoices::create_invoice(&state,serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":10,"recipientPhone":"33112233"}]})).unwrap(),"staff").await.unwrap();
    assert!(
        service::sales_closing(&state, Some(today()), branch)
            .await
            .unwrap()
            .read_only
    );
    assert!(matches!(
        till_service::save_opening(&state, opening(branch, today()), None, "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::save_opening(&state, opening(branch, tomorrow), None, "staff").await,
        Err(AppError::BadRequest(_))
    ));
}

#[sqlx::test]
async fn every_past_write_is_rejected_and_manager_resolutions_cannot_change_figures(pool: PgPool) {
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
    sqlx::query("INSERT INTO branch_closing_policies(branch_id,starts_on,configured_by,request_id,request_hash) VALUES($1,$2,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(old).execute(&pool).await.unwrap();
    let opening_id: Uuid=sqlx::query_scalar("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex')) RETURNING id").bind(branch).bind(old).fetch_one(&pool).await.unwrap();
    let expense_id: Uuid=sqlx::query_scalar("INSERT INTO branch_expenses(branch_id,business_date,amount,payment_type,reason,recorded_by,request_id,request_hash) VALUES($1,$2,5,'cash','Delivery','fixture',uuidv7(),decode(repeat('00',32),'hex')) RETURNING id").bind(branch).bind(old).fetch_one(&pool).await.unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let report = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
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
        Err(AppError::Conflict(_))
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
        rollout_service::resolve_missed(&state, resolution.clone(), "manager"),
        rollout_service::resolve_missed(&state, resolution, "manager")
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
    sqlx::query("INSERT INTO branch_closing_policies(branch_id,starts_on,configured_by,request_id,request_hash) VALUES($1,$2,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(old).execute(&pool).await.unwrap();
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
        rollout_service::resolve_missed(
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
