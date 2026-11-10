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
    ConfigureClosingInput {
        request_id: Uuid::new_v4(),
        branch_id: branch,
        starts_on,
    }
}
fn opening(branch: Uuid, date: NaiveDate) -> SaveOpeningInput {
    SaveOpeningInput {
        request_id: Uuid::new_v4(),
        branch_id: branch,
        date,
        amount: 50.0,
        notes: String::new(),
    }
}
fn counts() -> ClosingCounts {
    ClosingCounts {
        branch_activity_confirmed: true,
        opening_cash: 50.0,
        cash_added: 0.0,
        cash_removed: 0.0,
        actual_cash: 45.0,
        actual_benefit: 0.0,
        actual_card: 0.0,
        notes: String::new(),
    }
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
            && legacy.last_check.is_none()
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
    let input = SaveClosingInput {
        request_id: Uuid::new_v4(),
        branch_id: branch,
        date: old,
        fingerprint: report.fingerprint.clone(),
        counts: counts(),
    };
    assert!(matches!(
        service::save_check(&state, input.clone(), "staff").await,
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
            RecordExpenseInput {
                request_id: Uuid::new_v4(),
                branch_id: branch,
                date: old,
                amount: 1.0,
                payment_type: PaymentType::Cash,
                reason: "Late fee".into(),
                paid_to: String::new(),
                reference: String::new()
            },
            "staff"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        till_service::void_expense(
            &state,
            expense_id,
            VoidExpenseInput {
                request_id: Uuid::new_v4(),
                reason: "Attempted void".into()
            },
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        day_service::close_day(
            &state,
            CloseDayInput {
                request_id: Uuid::new_v4(),
                branch_id: branch,
                date: old,
                check_id: Uuid::new_v4(),
                fingerprint: report.fingerprint.clone()
            },
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    let resolution = ResolveMissedClosingInput {
        request_id: Uuid::new_v4(),
        branch_id: branch,
        date: old,
        reason: "Closing was missed; physical counts are unavailable.".into(),
    };
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
    assert!(frozen.last_check.is_none() && frozen.closure.is_none());
    assert!(matches!(
        service::save_check(&state, input, "manager").await,
        Err(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn an_existing_closed_historical_day_has_no_manager_reopen_path(pool: PgPool) {
    use super::{day_repository, reconciliation, repository};
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
    let input = SaveClosingInput {
        request_id: Uuid::new_v4(),
        branch_id: branch,
        date: old,
        fingerprint: report.fingerprint.clone(),
        counts,
    };
    let comparison = reconciliation::compare(&report, &input.counts).unwrap();
    // This fixture represents a report finalized on time before today's date.
    let mut tx = pool.begin().await.unwrap();
    let saved = repository::save_check(&mut tx, &input, &[0; 32], &comparison, &report, "fixture")
        .await
        .unwrap();
    day_repository::insert_closure(
        &mut tx,
        &CloseDayInput {
            request_id: Uuid::new_v4(),
            branch_id: branch,
            date: old,
            check_id: saved.id,
            fingerprint: report.fingerprint.clone(),
        },
        &[0; 32],
        "fixture",
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(matches!(
        rollout_service::resolve_missed(
            &state,
            ResolveMissedClosingInput {
                request_id: Uuid::new_v4(),
                branch_id: branch,
                date: old,
                reason: "Try reopening".into()
            },
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        service::save_check(&state, input, "manager").await,
        Err(AppError::Conflict(_))
    ));
    let frozen = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert!(frozen.read_only && frozen.closure.is_some() && frozen.missed_closing.is_none());
    assert_eq!(frozen.fingerprint, report.fingerprint);
}
