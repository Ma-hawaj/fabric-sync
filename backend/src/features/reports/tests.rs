use chrono::{DateTime, NaiveDate, Utc};
use sqlx::PgPool;

use super::{reconciliation, repository, service, types::*};
use uuid::Uuid;

fn date(value: &str) -> NaiveDate {
    value.parse().unwrap()
}
fn timestamp(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[test]
fn day_bounds_follow_business_midnights_including_dst() {
    let (start, end) = service::day_bounds(date("2026-11-02"), chrono_tz::Asia::Bahrain).unwrap();
    assert_eq!(start, timestamp("2026-11-01T21:00:00Z"));
    assert_eq!(end, timestamp("2026-11-02T21:00:00Z"));
    let (start, end) =
        service::day_bounds(date("2026-03-08"), chrono_tz::America::New_York).unwrap();
    assert_eq!((end - start).num_hours(), 23);
    let (start, end) =
        service::day_bounds(date("2026-11-01"), chrono_tz::America::New_York).unwrap();
    assert_eq!((end - start).num_hours(), 25);
    assert!(service::day_bounds(NaiveDate::MAX, chrono_tz::UTC).is_err());
}

#[test]
fn totals_use_cents_and_keep_gift_tender_and_unknown_methods_separate() {
    let rows = [
        ("sale", None, 10010),
        ("payment", Some("cash"), 10),
        ("payment", Some("cash"), 20),
        ("payment", None, 1500),
        ("refund", Some("cash"), 100),
        ("refund", Some("gift_card"), 200),
        ("gift_card_redemption", Some("gift_card"), 500),
        ("credit", None, 800),
        ("repair_payment", Some("card"), 700),
    ]
    .into_iter()
    .map(|(kind, method, amount_cents)| ActivityRow {
        branch_id: Some(Uuid::nil()),
        id: uuid::Uuid::new_v4(),
        invoice_id: uuid::Uuid::new_v4(),
        invoice_number: 1,
        occurred_at: Utc::now(),
        kind: kind.into(),
        method: method.map(String::from),
        amount_cents,
        taxable_cents: 0,
        vat_cents: 0,
        gift_sales_cents: 0,
    })
    .collect();
    let report = service::assemble(
        date("2026-11-02"),
        chrono_tz::Asia::Bahrain,
        Utc::now(),
        Uuid::nil(),
        "Test branch".into(),
        rows,
    );
    assert_eq!(report.summary.invoice_count, 1);
    assert_eq!(report.summary.net_invoice_activity, 92.10);
    assert_eq!(report.summary.net_external_receipts, 21.30);
    assert_eq!(report.summary.gift_card_redemptions, 5.0);
    assert_eq!(report.summary.gift_card_refunds, 2.0);
    assert_eq!(report.tenders[0].net, -0.70);
    assert_eq!(report.tenders[3].invoice_payments, 15.0);
}

#[sqlx::test]
async fn closing_uses_event_days_without_multiplying_ledgers(pool: PgPool) {
    let (old, orders, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE invoices SET invoice_date = '2026-10-30T12:00:00Z' WHERE id=$1")
        .bind(old)
        .execute(&pool)
        .await
        .unwrap();
    let sale: uuid::Uuid = sqlx::query_scalar("INSERT INTO invoices(total_price,vat_rate,taxable_amount,vat_amount,invoice_date) VALUES(130,0.1,100,10,'2026-11-01T21:00:00Z') RETURNING id")
        .fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE invoices SET branch_id=$1 WHERE id=$2")
        .bind(branch)
        .bind(sale)
        .execute(&pool)
        .await
        .unwrap();
    let card: uuid::Uuid = sqlx::query_scalar("INSERT INTO gift_cards(code,initial_amount,balance) VALUES('TEST-CLOSING',20,20) RETURNING id")
        .fetch_one(&pool).await.unwrap();
    sqlx::query("INSERT INTO invoice_items(invoice_id,kind,gift_card_id,description,quantity,unit_price,line_total) VALUES($1,'gift_card',$2,'Gift card',1,20,20)")
        .bind(sale).bind(card).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at) VALUES($1,20,'cash','2026-11-01T21:00:00Z'),($1,30,'benefit','2026-11-02T20:59:59Z'),($1,10,NULL,'2026-11-02T12:00:00Z'),($1,90,'cash','2026-11-01T20:59:59Z'),($1,80,'cash','2026-11-02T21:00:00Z')")
        .bind(old).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO invoice_returns(invoice_id,request_id,request_hash,reason,amount,created_by,created_at) VALUES($1,$2,decode(repeat('00',32),'hex'),'Test return',10,'test','2026-11-02T12:00:00Z')")
        .bind(old).bind(uuid::Uuid::new_v4()).execute(&pool).await.unwrap();
    for (method, amount, gift) in [("cash", 5.0, None), ("gift_card", 3.0, Some(card))] {
        sqlx::query("INSERT INTO invoice_refunds(invoice_id,request_id,request_hash,reason,amount,payment_type,gift_card_id,created_by,created_at) VALUES($1,$2,decode(repeat('00',32),'hex'),'Test refund',$3,$4,$5,'test','2026-11-02T12:00:00Z')")
            .bind(old).bind(uuid::Uuid::new_v4()).bind(amount).bind(method).bind(gift)
            .execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO gift_card_redemptions(gift_card_id,invoice_id,amount,redeemed_at) VALUES($1,$2,12,'2026-11-02T12:00:00Z')")
        .bind(card).bind(old).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO order_repairs(order_id,reason,status,received_at,received_amount,received_payment_type) VALUES($1,'Test repair','received','2026-11-02T12:00:00Z',7,'card')")
        .bind(orders[0]).execute(&pool).await.unwrap();
    let day = date("2026-11-02");
    let zone = chrono_tz::Asia::Bahrain;
    let (start, end) = service::day_bounds(day, zone).unwrap();
    let rows = repository::activity(&mut *pool.acquire().await.unwrap(), start, end, branch)
        .await
        .unwrap();
    let report = service::assemble(day, zone, Utc::now(), branch, "Test branch".into(), rows);
    assert_eq!(report.activity.len(), 9);
    assert_eq!(report.summary.invoice_count, 1);
    assert_eq!(report.summary.invoice_total, 130.0);
    assert_eq!(report.summary.taxable_amount, 100.0);
    assert_eq!(report.summary.vat_amount, 10.0);
    assert_eq!(report.summary.gift_card_sales, 20.0);
    assert_eq!(report.summary.credits, 10.0);
    assert_eq!(report.summary.net_invoice_activity, 120.0);
    assert_eq!(report.summary.invoice_payments, 60.0);
    assert_eq!(report.summary.repair_payments, 7.0);
    assert_eq!(report.summary.external_refunds, 5.0);
    assert_eq!(report.summary.net_external_receipts, 62.0);
    assert_eq!(report.summary.gift_card_redemptions, 12.0);
    assert_eq!(report.summary.gift_card_refunds, 3.0);
    let rows = repository::activity(
        &mut *pool.acquire().await.unwrap(),
        end + chrono::Duration::days(5),
        end + chrono::Duration::days(6),
        branch,
    )
    .await
    .unwrap();
    let empty = service::assemble(
        date("2026-11-08"),
        zone,
        Utc::now(),
        branch,
        "Test branch".into(),
        rows,
    );
    assert_eq!(empty.summary.invoice_count, 0);
    assert_eq!(empty.summary.net_external_receipts, 0.0);
    assert!(empty.activity.is_empty());
}

fn matching_counts(cash: f64) -> ClosingCounts {
    serde_json::from_value::<ClosingCounts>(serde_json::json!({
        "branchActivityConfirmed": true,
        "openingCash": 5.0,
        "cashAdded": 0.0,
        "cashRemoved": 0.0,
        "actualCash": cash + 5.0,
        "actualBenefit": 0.0,
        "actualCard": 0.0,
        "notes": "",
    }))
    .unwrap()
}

#[test]
fn physical_counts_keep_fils_and_never_match_unknown_methods() {
    let mut report = service::assemble(
        date("2026-11-02"),
        chrono_tz::Asia::Bahrain,
        Utc::now(),
        Uuid::nil(),
        "Main".into(),
        vec![],
    );
    report.opening = Some(CashOpening {
        id: Uuid::new_v4(),
        amount: 5.0,
        recorded_at: Utc::now(),
        recorded_by: "test".into(),
        notes: String::new(),
        supersedes_id: None,
    });
    let counts = matching_counts(0.0);
    assert!(reconciliation::compare(&report, &counts).unwrap().matched);
    let mut short = counts.clone();
    short.actual_cash = 4.999;
    assert!(reconciliation::compare(&report, &short).is_err());
    short.notes = "One fils short".into();
    let result = reconciliation::compare(&report, &short).unwrap();
    assert_eq!(result.lines[0].difference, -0.001);
    assert!(!result.matched);
    short.actual_cash = 5.0001;
    assert!(reconciliation::compare(&report, &short).is_err());
    report.summary.unrecorded_method_count = 1;
    assert!(!reconciliation::compare(&report, &counts).unwrap().matched);
    report.summary.unrecorded_method_count = 0;
    report.unassigned_activity_count = 1;
    assert!(!reconciliation::compare(&report, &counts).unwrap().matched);
    let mut unconfirmed = counts;
    unconfirmed.branch_activity_confirmed = false;
    assert!(reconciliation::compare(&report, &unconfirmed).is_err());
}

#[sqlx::test]
async fn final_closings_are_isolated_idempotent_and_freeze_the_recorded_activity(pool: PgPool) {
    let day = chrono::Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive();
    let (invoice, _, _, branch) = crate::test_support::invoice(&pool, 1, false).await;
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,10,'cash')",
    )
    .bind(invoice)
    .execute(&pool)
    .await
    .unwrap();
    let other: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Other report branch') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO invoices(branch_id,total_price,vat_rate,taxable_amount,vat_amount) VALUES($1,50,.1,45.45,4.55)").bind(other).execute(&pool).await.unwrap();
    let state = crate::test_support::state_without_openings(pool.clone(), None, None).await;
    super::till_service::save_opening(
        &state,
        serde_json::from_value::<SaveOpeningInput>(serde_json::json!({
            "requestId": Uuid::new_v4(),
            "branchId": branch,
            "date": day,
            "amount": 5.0,
            "notes": "",
        }))
        .unwrap(),
        None,
        "opening-staff",
    )
    .await
    .unwrap();
    let report = service::sales_closing(&state, Some(day), branch)
        .await
        .unwrap();
    assert_eq!(report.summary.invoice_count, 1);
    assert_eq!(report.summary.invoice_total, 100.0);
    assert_eq!(report.summary.invoice_payments, 10.0);
    assert!(report.closure.is_none());
    let input = serde_json::from_value::<CloseDayInput>(serde_json::json!({
        "requestId": Uuid::new_v4(),
        "branchId": branch,
        "date": report.date,
        "fingerprint": report.fingerprint.clone(),
        "counts": matching_counts(10.0),
    }))
    .unwrap();
    let saved = super::day_service::close_day(&state, input.clone(), "staff-one")
        .await
        .unwrap();
    assert!(saved.closure.as_ref().unwrap().comparison.matched);
    let replay = super::day_service::close_day(&state, input.clone(), "staff-one")
        .await
        .unwrap();
    assert_eq!(
        replay.closure.unwrap().id,
        saved.closure.as_ref().unwrap().id
    );
    let stored_actor: String =
        sqlx::query_scalar("SELECT closed_by FROM branch_day_closures WHERE id=$1")
            .bind(saved.closure.as_ref().unwrap().id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_actor, "staff-one");
    let mut changed = input.clone();
    changed.counts.actual_cash = 14.0;
    changed.counts.notes = "Short by one".into();
    assert!(matches!(
        super::day_service::close_day(&state, changed, "staff-one").await,
        Err(crate::error::AppError::Conflict(_))
    ));
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,1,'cash')")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let after = service::sales_closing(&state, Some(report.date), branch)
        .await
        .unwrap();
    assert_eq!(after.fingerprint, saved.fingerprint);
    assert_eq!(
        after.closure.as_ref().unwrap().id,
        saved.closure.as_ref().unwrap().id
    );
    let mut stale = input.clone();
    stale.request_id = Uuid::new_v4();
    assert!(matches!(
        super::day_service::close_day(&state, stale, "staff-two").await,
        Err(crate::error::AppError::Conflict(_))
    ));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM branch_day_closures")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    let other_report = service::sales_closing(&state, Some(report.date), other)
        .await
        .unwrap();
    assert_eq!(other_report.summary.invoice_total, 50.0);
    assert!(other_report.closure.is_none());
    let unassigned: Uuid = sqlx::query_scalar("INSERT INTO invoices(total_price,vat_rate,taxable_amount,vat_amount) VALUES(20,.1,18.18,1.82) RETURNING id").fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,20,'cash')",
    )
    .bind(unassigned)
    .execute(&pool)
    .await
    .unwrap();
    let with_unassigned = service::sales_closing(&state, Some(report.date), other)
        .await
        .unwrap();
    assert_eq!(with_unassigned.unassigned_activity_count, 1);
    assert_eq!(with_unassigned.summary.invoice_payments, 0.0);
    assert!(with_unassigned.closure.is_none());
}
