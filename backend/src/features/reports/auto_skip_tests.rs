use chrono::{Days, NaiveDate, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    day_repository, day_service, missed_service, reconciliation, service, till_service, types::*,
};
use crate::{error::AppError, features::invoices::service as invoices, test_support};

fn ago(days: u64) -> NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive()
        .checked_sub_days(Days::new(days))
        .unwrap()
}

async fn seed_opening(pool: &PgPool, branch: Uuid, date: NaiveDate) {
    sqlx::query("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex'))")
        .bind(branch).bind(date).execute(pool).await.unwrap();
}

async fn seed_disabled(pool: &PgPool, branch: Uuid) {
    // Represents a check disabled in an earlier business day, without changing
    // the application clock or running a request with a forged business date.
    sqlx::query("UPDATE branch SET daily_check_required=false,daily_check_changed_at=$2,daily_check_changed_by='disabling-manager' WHERE id=$1")
        .bind(branch).bind(service::day_bounds(ago(6),chrono_tz::Asia::Bahrain).unwrap().0)
        .execute(pool).await.unwrap();
}

fn setting(branch: Uuid, required: bool) -> UpdateDailyCheckInput {
    serde_json::from_value(json!({"branchId":branch,"required":required})).unwrap()
}

fn opening(branch: Uuid) -> SaveOpeningInput {
    serde_json::from_value(
        json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(0),"amount":50}),
    )
    .unwrap()
}

#[sqlx::test]
async fn reenabling_skips_disabled_days_once_and_preserves_existing_saved_reports(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    let before_tracking = service::day_bounds(ago(7), chrono_tz::Asia::Bahrain)
        .unwrap()
        .0;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(before_tracking)
        .execute(&pool)
        .await
        .unwrap();
    seed_opening(&pool, branch, ago(6)).await;
    seed_opening(&pool, branch, ago(5)).await;
    seed_disabled(&pool, branch).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let manual = missed_service::resolve_missed(&state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(6),"reason":"Previously reviewed by a manager."})).unwrap(),"original-manager").await.unwrap();
    let closed_report = service::sales_closing(&state, Some(ago(5)), branch)
        .await
        .unwrap();
    let input: CloseDayInput = serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"branchId":branch,"date":ago(5),"fingerprint":closed_report.fingerprint,
        "counts":{"branchActivityConfirmed":true,"openingCash":50,"cashAdded":0,"cashRemoved":0,"actualCash":50,"actualBenefit":0,"actualCard":0,"notes":""}
    })).unwrap();
    let comparison = reconciliation::compare(&closed_report, &input.counts).unwrap();
    let mut tx = pool.begin().await.unwrap();
    day_repository::insert_closure(
        &mut tx,
        &input,
        &comparison,
        &closed_report,
        &[0; 32],
        "original-closer",
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let closed_before: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM branch_day_closures c WHERE branch_id=$1")
            .bind(branch)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO branch_expenses(branch_id,business_date,amount,payment_type,reason,recorded_by,request_id,request_hash) VALUES($1,$2,5,'cash','Delivery','staff',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(ago(3)).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at) VALUES($1,20,'cash',$2)").bind(invoice).bind(service::day_bounds(ago(1),chrono_tz::Asia::Bahrain).unwrap().0).execute(&pool).await.unwrap();
    let other: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Other branch') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    seed_opening(&pool, other, ago(1)).await;
    let expense_before = service::sales_closing(&state, Some(ago(3)), branch)
        .await
        .unwrap();
    let payment_before = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    let status = day_service::status(&state, branch).await.unwrap();
    assert!(status.can_trade && status.previous_unclosed_date.is_none());
    let (a, b) = tokio::join!(
        day_service::set_daily_check(&state, setting(branch, true), "enabling-manager"),
        day_service::set_daily_check(&state, setting(branch, true), "retry-manager")
    );
    for enabled in [a.unwrap(), b.unwrap()] {
        assert!(enabled.daily_check_required && !enabled.can_trade);
        assert!(enabled.previous_unclosed_date.is_none());
        assert_eq!(enabled.tracking_start_date, Some(ago(6)));
    }
    for before in [expense_before, payment_before] {
        let frozen = service::sales_closing(&state, Some(before.date), branch)
            .await
            .unwrap();
        assert_eq!(frozen.fingerprint, before.fingerprint);
        assert!(frozen.read_only && frozen.closure.is_none());
        let skip = frozen.missed_closing.unwrap();
        assert!(skip.reason.contains("Automatically skipped"));
        assert_eq!(skip.resolved_by, "disabling-manager");
        assert!(matches!(missed_service::resolve_missed(&state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":before.date,"reason":"Try rewriting the skip."})).unwrap(),"manager").await,Err(AppError::Conflict(_))));
    }
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM branch_missed_closings WHERE branch_id=$1")
            .bind(branch)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rows, 3); // Original manual skip plus the two active disabled days.
    let manual_after = service::sales_closing(&state, Some(ago(6)), branch)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(manual_after.missed_closing).unwrap(),
        serde_json::to_value(manual.missed_closing).unwrap()
    );
    let closed_after: serde_json::Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM branch_day_closures c WHERE branch_id=$1")
            .bind(branch)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(closed_after, closed_before);
    assert_eq!(
        day_service::status(&state, other)
            .await
            .unwrap()
            .previous_unclosed_date,
        Some(ago(1))
    );
    till_service::save_opening(&state, opening(branch), None, "staff")
        .await
        .unwrap();
    assert!(day_service::status(&state, branch).await.unwrap().can_trade);
    // A new missed day under the enabled restriction still blocks trading.
    seed_opening(&pool, branch, ago(2)).await;
    let still_enabled = day_service::set_daily_check(&state, setting(branch, true), "manager")
        .await
        .unwrap();
    assert_eq!(still_enabled.previous_unclosed_date, Some(ago(2)));
    assert!(!still_enabled.can_trade);
}

#[sqlx::test]
async fn trading_while_disabled_freezes_the_previous_day_without_skipping_today(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    seed_opening(&pool, branch, ago(1)).await;
    seed_disabled(&pool, branch).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let before = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    invoices::record_payment(
        &state,
        invoice,
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
            .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let skipped = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    assert_eq!(skipped.fingerprint, before.fingerprint);
    let skip_id = skipped.missed_closing.unwrap().id;
    let today = service::sales_closing(&state, Some(ago(0)), branch)
        .await
        .unwrap();
    assert!(today.missed_closing.is_none() && today.closure.is_none());
    assert_eq!(today.summary.invoice_payments, 5.0);
    let enabled = day_service::set_daily_check(&state, setting(branch, true), "manager")
        .await
        .unwrap();
    assert!(!enabled.can_trade && enabled.previous_unclosed_date.is_none());
    assert!(
        matches!(till_service::save_opening(&state,opening(branch),None,"staff").await,Err(AppError::Conflict(message)) if message.contains("counted twice"))
    );
    assert_eq!(
        service::sales_closing(&state, Some(ago(1)), branch)
            .await
            .unwrap()
            .missed_closing
            .unwrap()
            .id,
        skip_id
    );
}

#[sqlx::test]
async fn opening_and_closing_while_disabled_skip_prior_days_and_keep_normal_closing(pool: PgPool) {
    let (_, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    seed_opening(&pool, branch, ago(1)).await;
    seed_disabled(&pool, branch).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let report = service::sales_closing(&state, Some(ago(0)), branch)
        .await
        .unwrap();
    assert!(report.previous_unclosed_date.is_none());
    till_service::save_opening(&state, opening(branch), None, "staff")
        .await
        .unwrap();
    assert!(service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap()
        .missed_closing
        .is_some());
    let report = service::sales_closing(&state, Some(ago(0)), branch)
        .await
        .unwrap();
    let input = serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"branchId":branch,"date":ago(0),"fingerprint":report.fingerprint,
        "counts":{"branchActivityConfirmed":true,"openingCash":50,"cashAdded":0,"cashRemoved":0,"actualCash":50,"actualBenefit":0,"actualCard":0,"notes":""}
    })).unwrap();
    let closed = day_service::close_day(&state, input, "staff")
        .await
        .unwrap();
    assert!(closed.closure.is_some() && closed.missed_closing.is_none());
    assert!(
        !day_service::set_daily_check(&state, setting(branch, false), "manager")
            .await
            .unwrap()
            .can_trade
    );
}

#[sqlx::test]
async fn disabling_before_first_opening_does_not_fabricate_a_tracking_start_or_skips(pool: PgPool) {
    let (invoice, _, _, branch) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(
            service::day_bounds(ago(1), chrono_tz::Asia::Bahrain)
                .unwrap()
                .0,
        )
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let off = day_service::set_daily_check(&state, setting(branch, false), "manager")
        .await
        .unwrap();
    assert!(off.can_trade && off.tracking_start_date.is_none());
    let on = day_service::set_daily_check(&state, setting(branch, true), "manager")
        .await
        .unwrap();
    assert!(
        !on.can_trade && on.previous_unclosed_date.is_none() && on.tracking_start_date.is_none()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_missed_closings")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    till_service::save_opening(&state, opening(branch), None, "staff")
        .await
        .unwrap();
    assert_eq!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .tracking_start_date,
        Some(ago(0))
    );
}
