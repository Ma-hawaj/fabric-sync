use chrono::{Days, NaiveDate, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{day_service, missed_service, service, till_service, types::*};
use crate::{
    error::AppError, features::invoices::service as invoices, state::AppState, test_support,
};

fn ago(days: u64) -> NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive()
        .checked_sub_days(Days::new(days))
        .unwrap()
}

async fn seed_opening(pool: &PgPool, branch: Uuid, date: NaiveDate) -> Uuid {
    sqlx::query_scalar("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex')) RETURNING id")
        .bind(branch).bind(date).fetch_one(pool).await.unwrap()
}

async fn empty_branch(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("INSERT INTO branch(name) VALUES($1) RETURNING id")
        .bind(format!("Late closing {}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .unwrap()
}

fn opening(branch: Uuid) -> SaveOpeningInput {
    serde_json::from_value(
        json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(0),"amount":50}),
    )
    .unwrap()
}

async fn closing(state: &AppState, branch: Uuid, date: NaiveDate) -> CloseDayInput {
    let report = service::sales_closing(state, Some(date), branch)
        .await
        .unwrap();
    serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"branchId":branch,"date":date,"fingerprint":report.fingerprint,
        "counts":{"branchActivityConfirmed":true,"openingCash":50,"cashAdded":0,"cashRemoved":0,"actualCash":50,"actualBenefit":0,"actualCard":0,"notes":"Counted before the next opening; yesterday's closing was missed."}
    })).unwrap()
}

async fn skip(state: &AppState, branch: Uuid, date: NaiveDate) {
    missed_service::resolve_missed(state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":date,"reason":"Physical counts were not recovered."})).unwrap(),"manager").await.unwrap();
}

#[sqlx::test]
async fn an_opening_without_sales_requires_closing_before_the_next_opening(pool: PgPool) {
    let branch = empty_branch(&pool).await;
    let opening_id = seed_opening(&pool, branch, ago(1)).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let report = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    assert!(report.read_only && report.activity.is_empty());
    assert_eq!(report.late_closing_date, Some(ago(1)));
    let status = day_service::status(&state, branch).await.unwrap();
    assert_eq!(status.previous_unclosed_date, Some(ago(1)));
    assert_eq!(status.late_closing_date, Some(ago(1)));
    assert!(!status.can_trade);
    assert!(
        matches!(till_service::save_opening(&state,opening(branch),None,"staff").await,Err(AppError::Conflict(message)) if message.contains("no sales"))
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM branch_cash_openings WHERE branch_id=$1 AND business_date=$2"
        )
        .bind(branch)
        .bind(ago(0))
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    // Late closing does not allow any change to the old opening or expenses.
    let mut correction: SaveOpeningInput = serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(1),"amount":55,"notes":"Try changing yesterday's float."})).unwrap();
    assert!(matches!(
        till_service::save_opening(&state, correction.clone(), Some(opening_id), "manager").await,
        Err(AppError::Conflict(_))
    ));
    correction.request_id = Uuid::new_v4();
    assert!(matches!(
        till_service::save_opening(&state, correction, None, "manager").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(till_service::record_expense(&state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(1),"amount":5,"paymentType":"cash","reason":"Late delivery fee"})).unwrap(),"staff").await,Err(AppError::Conflict(_))));

    let input = closing(&state, branch, ago(1)).await;
    let saved = day_service::close_day(&state, input.clone(), "morning-staff")
        .await
        .unwrap();
    assert!(saved.read_only && saved.missed_closing.is_none());
    assert_eq!(saved.fingerprint, report.fingerprint);
    let closed = saved.closure.unwrap();
    assert!(closed.late && closed.comparison.matched);
    assert_eq!(closed.closed_by, "morning-staff");
    assert_eq!(
        closed
            .closed_at
            .with_timezone(&chrono_tz::Asia::Bahrain)
            .date_naive(),
        ago(0)
    );
    assert_eq!(closed.counts.notes, input.counts.notes);
    let fetched = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    assert!(fetched.closure.unwrap().late);
    let waiting = day_service::status(&state, branch).await.unwrap();
    assert!(waiting.previous_unclosed_date.is_none() && !waiting.can_trade && !waiting.closed);
    till_service::save_opening(&state, opening(branch), None, "staff")
        .await
        .unwrap();
    assert!(day_service::status(&state, branch).await.unwrap().can_trade);
    let retried = day_service::close_day(&state, input.clone(), "retry-staff")
        .await
        .unwrap();
    assert_eq!(retried.closure.unwrap().id, closed.id);
    let mut changed = input;
    changed.request_id = Uuid::new_v4();
    assert!(matches!(
        day_service::close_day(&state, changed, "manager").await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(missed_service::resolve_missed(&state,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":ago(1),"reason":"Try replacing the close."})).unwrap(),"manager").await,Err(AppError::Conflict(_))));
}

#[sqlx::test]
async fn late_closing_needs_the_last_active_days_opening_and_an_explanation(pool: PgPool) {
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
    seed_opening(&pool, branch, ago(2)).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    assert!(day_service::status(&state, branch)
        .await
        .unwrap()
        .late_closing_date
        .is_none());
    for date in [ago(2), ago(1)] {
        assert!(matches!(
            day_service::close_day(&state, closing(&state, branch, date).await, "staff").await,
            Err(AppError::Conflict(_))
        ));
    }
    seed_opening(&pool, branch, ago(1)).await;
    // An older unresolved active day must be resolved first.
    assert!(day_service::status(&state, branch)
        .await
        .unwrap()
        .late_closing_date
        .is_none());
    skip(&state, branch, ago(2)).await;
    assert_eq!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .late_closing_date,
        Some(ago(1))
    );
    let mut input = closing(&state, branch, ago(1)).await;
    input.counts.notes.clear();
    assert!(
        matches!(day_service::close_day(&state,input.clone(),"staff").await,Err(AppError::BadRequest(message)) if message.contains("closed late"))
    );
    input.counts.notes = "Finished before the next opening.".into();
    let valid_fingerprint = input.fingerprint.clone();
    input.fingerprint = "stale report".into();
    assert!(
        matches!(day_service::close_day(&state,input.clone(),"staff").await,Err(AppError::Conflict(message)) if message.contains("Refresh"))
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_day_closures WHERE branch_id=$1")
            .bind(branch)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    input.fingerprint = valid_fingerprint;
    let saved = day_service::close_day(&state, input, "staff")
        .await
        .unwrap();
    assert!(saved.closure.unwrap().late);
    assert!(matches!(
        day_service::close_day(&state, closing(&state, branch, ago(2)).await, "manager").await,
        Err(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn any_today_activity_ends_the_late_window_even_with_checks_disabled(pool: PgPool) {
    for kind in ["opening", "invoice", "payment", "expense"] {
        let branch = empty_branch(&pool).await;
        let invoice: Uuid = sqlx::query_scalar("INSERT INTO invoices(branch_id,total_price,vat_rate,taxable_amount,vat_amount,invoice_date) VALUES($1,100,0.1,90.91,9.09,$2) RETURNING id")
            .bind(branch)
            .bind(
                service::day_bounds(ago(1), chrono_tz::Asia::Bahrain)
                    .unwrap()
                    .0,
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        seed_opening(&pool, branch, ago(1)).await;
        // Simulate a check disabled before yesterday ended, without triggering
        // auto-skip first: the late window must still close on today's activity.
        sqlx::query("UPDATE branch SET daily_check_required=false WHERE id=$1")
            .bind(branch)
            .execute(&pool)
            .await
            .unwrap();
        let state = test_support::state_without_openings(pool.clone(), None, None).await;
        assert_eq!(
            day_service::status(&state, branch)
                .await
                .unwrap()
                .late_closing_date,
            Some(ago(1))
        );
        let input = closing(&state, branch, ago(1)).await;
        match kind {
            "opening" => {
                seed_opening(&pool, branch, ago(0)).await;
            }
            "invoice" => {
                sqlx::query("UPDATE invoices SET invoice_date=now() WHERE id=$1")
                    .bind(invoice)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            "payment" => {
                // Bahrain's business day starts on the previous UTC date.
                let when = service::day_bounds(ago(0), chrono_tz::Asia::Bahrain)
                    .unwrap()
                    .0
                    + chrono::Duration::minutes(5);
                sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at) VALUES($1,5,'cash',$2)").bind(invoice).bind(when).execute(&pool).await.unwrap();
            }
            "expense" => {
                sqlx::query("INSERT INTO branch_expenses(branch_id,business_date,amount,payment_type,reason,recorded_by,request_id,request_hash) VALUES($1,$2,5,'cash','Delivery','fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(ago(0)).execute(&pool).await.unwrap();
            }
            _ => unreachable!(),
        }
        let status = day_service::status(&state, branch).await.unwrap();
        assert!(
            status.can_trade && status.late_closing_date.is_none(),
            "{kind}"
        );
        assert!(
            matches!(
                day_service::close_day(&state, input, "staff").await,
                Err(AppError::Conflict(_))
            ),
            "{kind}"
        );
        let other = empty_branch(&pool).await;
        seed_opening(&pool, other, ago(1)).await;
        assert_eq!(
            day_service::status(&state, other)
                .await
                .unwrap()
                .late_closing_date,
            Some(ago(1))
        );
    }
}

#[sqlx::test]
async fn late_closing_and_the_next_opening_are_serialized_even_after_quiet_days(pool: PgPool) {
    let branch = empty_branch(&pool).await;
    seed_opening(&pool, branch, ago(3)).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let input = closing(&state, branch, ago(3)).await;
    assert_eq!(
        day_service::status(&state, branch)
            .await
            .unwrap()
            .late_closing_date,
        Some(ago(3))
    );
    let initial = opening(branch);
    let (closed, opened) = tokio::join!(
        day_service::close_day(&state, input.clone(), "staff"),
        till_service::save_opening(&state, initial.clone(), None, "staff")
    );
    let saved = closed.unwrap();
    assert!(saved.closure.unwrap().late);
    if let Err(error) = opened {
        assert!(matches!(error, AppError::Conflict(_)));
    }
    till_service::save_opening(&state, initial, None, "staff")
        .await
        .unwrap();
    assert!(day_service::status(&state, branch).await.unwrap().can_trade);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_day_closures WHERE branch_id=$1")
            .bind(branch)
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM branch_cash_openings WHERE branch_id=$1 AND business_date=$2"
        )
        .bind(branch)
        .bind(ago(0))
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[sqlx::test]
async fn disabled_trading_and_late_closing_cannot_both_finalize_the_past_day(pool: PgPool) {
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
    seed_opening(&pool, branch, ago(1)).await;
    sqlx::query("UPDATE branch SET daily_check_required=false WHERE id=$1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let input = closing(&state, branch, ago(1)).await;
    let payment =
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"amount":5,"paymentType":"cash"}))
            .unwrap();
    let (closed, paid) = tokio::join!(
        day_service::close_day(&state, input.clone(), "staff"),
        invoices::record_payment(&state, invoice, payment, "staff")
    );
    paid.unwrap();
    let report = service::sales_closing(&state, Some(ago(1)), branch)
        .await
        .unwrap();
    assert_eq!(report.fingerprint, input.fingerprint);
    match closed {
        Ok(saved) => {
            assert!(saved.closure.unwrap().late);
            assert!(report.missed_closing.is_none() && report.closure.is_some());
        }
        Err(error) => {
            assert!(matches!(error, AppError::Conflict(_)));
            assert!(report.missed_closing.is_some() && report.closure.is_none());
        }
    }
    assert!(day_service::status(&state, branch)
        .await
        .unwrap()
        .late_closing_date
        .is_none());
}
