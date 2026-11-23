use chrono::{Days, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::features::invoices::{
    financial_branch_service::assign, service, types::AssignFinancialBranchInput,
};
use crate::{error::AppError, features::reports, test_support};

fn input(request: Uuid, branch: Uuid, reason: &str) -> AssignFinancialBranchInput {
    serde_json::from_value(json!({"requestId":request,"branchId":branch,"reason":reason})).unwrap()
}

async fn legacy(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("INSERT INTO invoices(total_price,vat_rate,taxable_amount,vat_amount) VALUES(100,0.1,90.91,9.09) RETURNING id")
        .fetch_one(pool).await.unwrap()
}

#[sqlx::test]
async fn recovery_preserves_old_activity_and_frozen_reports_but_attributes_new_payments(
    pool: PgPool,
) {
    let branch = test_support::trading_branch(&pool).await;
    let invoice = legacy(&pool).await;
    let today = Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive();
    let old = today.checked_sub_days(Days::new(2)).unwrap();
    let tracking_start = today.checked_sub_days(Days::new(3)).unwrap();
    let yesterday = today.checked_sub_days(Days::new(1)).unwrap();
    sqlx::query("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,0,'fixture',uuidv7(),decode(repeat('00',32),'hex'))")
        .bind(branch).bind(tracking_start).execute(&pool).await.unwrap();
    let issued = reports::service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0
        + chrono::Duration::hours(8);
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(issued)
        .execute(&pool)
        .await
        .unwrap();
    let payment: Uuid = sqlx::query_scalar("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at,recorded_by) VALUES($1,20,'cash',$2,'original-staff') RETURNING id")
        .bind(invoice).bind(issued).fetch_one(&pool).await.unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let tracked_report = reports::service::sales_closing(&state, Some(tracking_start), branch)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_missed_closings(branch_id,business_date,reason,resolved_by,report_snapshot,request_id,request_hash) VALUES($1,$2,'Historic opening','manager',$3,uuidv7(),decode(repeat('00',32),'hex'))")
        .bind(branch).bind(tracking_start).bind(serde_json::to_value(tracked_report).unwrap()).execute(&pool).await.unwrap();
    let yesterday_receipt = reports::service::day_bounds(yesterday, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0
        + chrono::Duration::hours(8);
    // A tracked but unfinalized past day must not become a new closing backlog.
    // A receipt earlier today must also stay excluded from drawer totals.
    for paid_at in [
        yesterday_receipt,
        Utc::now() - chrono::Duration::milliseconds(1),
    ] {
        sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type,paid_at) VALUES($1,3,'cash',$2)")
            .bind(invoice).bind(paid_at).execute(&pool).await.unwrap();
    }
    let original = reports::service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    let frozen = serde_json::to_value(&original).unwrap();
    sqlx::query("INSERT INTO branch_missed_closings(branch_id,business_date,reason,resolved_by,report_snapshot,request_id,request_hash) VALUES($1,$2,'Unrecoverable count','manager',$3,uuidv7(),decode(repeat('00',32),'hex'))")
        .bind(branch).bind(old).bind(&frozen).execute(&pool).await.unwrap();
    let request = Uuid::new_v4();
    let saved = assign(
        &state,
        invoice,
        input(request, branch, "Imported invoice needs settlement"),
        "recovery-manager",
    )
    .await
    .unwrap();
    assert_eq!(saved.branch_id, Some(branch));
    assert_eq!(saved.assigned_by.as_deref(), Some("recovery-manager"));
    assert!(saved.assigned_at.is_some());
    let detail = service::get_invoice(&state, invoice).await.unwrap();
    assert_eq!(detail.financial_branch.branch_id, Some(branch));
    assert_eq!(detail.date, issued);
    assert_eq!(detail.payments[0].id, payment);
    assert_eq!(
        detail.payments[0].recorded_by.as_deref(),
        Some("original-staff")
    );
    let after: serde_json::Value = sqlx::query_scalar("SELECT report_snapshot FROM branch_missed_closings WHERE branch_id=$1 AND business_date=$2")
        .bind(branch).bind(old).fetch_one(&pool).await.unwrap();
    assert_eq!(after, frozen);
    // The live historical query also preserves the unassigned owner, independently of the saved snapshot.
    let (start, end) = reports::service::day_bounds(old, chrono_tz::Asia::Bahrain).unwrap();
    let rows =
        reports::repository::activity(&mut *pool.acquire().await.unwrap(), start, end, branch)
            .await
            .unwrap();
    assert!(rows
        .iter()
        .filter(|row| row.invoice_id == invoice)
        .all(|row| row.branch_id.is_none()));
    service::record_payment(
        &state,
        invoice,
        serde_json::from_value(
            json!({"requestId":Uuid::new_v4(),"amount":10,"paymentType":"cash"}),
        )
        .unwrap(),
        "cashier",
    )
    .await
    .unwrap();
    let current = reports::service::sales_closing(&state, Some(today), branch)
        .await
        .unwrap();
    assert_eq!(current.summary.invoice_count, 0);
    assert_eq!(current.summary.net_external_receipts, 10.0);
    assert_eq!(current.unassigned_activity_count, 1);
    assert!(reports::day_service::status(&state, branch)
        .await
        .unwrap()
        .previous_unclosed_date
        .is_none());
    let retry = assign(
        &state,
        invoice,
        input(request, branch, "Imported invoice needs settlement"),
        "different-manager",
    )
    .await
    .unwrap();
    assert_eq!(retry.assigned_at, saved.assigned_at);
    assert_eq!(retry.assigned_by, saved.assigned_by);
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(request, branch, "Changed reason"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, "Reassign"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn recovery_requires_an_open_active_branch_and_preserves_existing_owners(pool: PgPool) {
    let branch: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Recovery') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let invoice = legacy(&pool).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, "Missing opening"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    test_support::open_branch(&pool, branch).await;
    sqlx::query("UPDATE branch SET is_active=false WHERE id=$1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, "Inactive branch"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    sqlx::query("UPDATE branch SET is_active=true WHERE id=$1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, " "),
            "manager"
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        assign(&state, invoice, input(Uuid::new_v4(), branch, "Reason"), "").await,
        Err(AppError::Unauthorized(_))
    ));
    sqlx::query("UPDATE invoices SET branch_id=$2 WHERE id=$1")
        .bind(invoice)
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, "Already has pickup owner"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    sqlx::query("UPDATE invoices SET branch_id=NULL,issuing_branch_id=$2 WHERE id=$1")
        .bind(invoice)
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), branch, "Already has issuer"),
            "manager"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
}

#[sqlx::test]
async fn stale_transactions_cannot_backdate_tender_across_recovery_and_recovered_tender_stays_fixed(
    pool: PgPool,
) {
    let branch = test_support::trading_branch(&pool).await;
    let invoice = legacy(&pool).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let mut stale = pool.begin().await.unwrap();
    sqlx::query("SELECT transaction_timestamp()")
        .execute(&mut *stale)
        .await
        .unwrap();
    assign(
        &state,
        invoice,
        input(Uuid::new_v4(), branch, "Recovered"),
        "manager",
    )
    .await
    .unwrap();
    assert!(matches!(
        reports::day_service::require_invoice_trading(&state, &mut stale, invoice).await,
        Err(AppError::Conflict(_))
    ));
    stale.rollback().await.unwrap();
    let update=serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":100,"recipientPhone":"33112233"}],"giftCardRedemptions":[{"code":"GC-7KMP-4RWT-9DXH","amount":5}]})).unwrap();
    let error = service::update_invoice(&state, invoice, update)
        .await
        .unwrap_err();
    assert!(
        matches!(error,AppError::Conflict(ref message) if message.contains("must stay unchanged"))
    );
}

#[sqlx::test]
async fn concurrent_recovery_has_one_winner_and_never_overwrites_attribution(pool: PgPool) {
    let first = test_support::trading_branch(&pool).await;
    let second = test_support::trading_branch(&pool).await;
    let invoice = legacy(&pool).await;
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let (a, b) = tokio::join!(
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), first, "First request"),
            "first-manager"
        ),
        assign(
            &state,
            invoice,
            input(Uuid::new_v4(), second, "Second request"),
            "second-manager"
        )
    );
    assert_ne!(a.is_ok(), b.is_ok());
    let saved = service::get_invoice(&state, invoice)
        .await
        .unwrap()
        .financial_branch;
    if a.is_ok() {
        assert_eq!(saved.branch_id, Some(first));
        assert_eq!(saved.assigned_by.as_deref(), Some("first-manager"));
    } else {
        assert_eq!(saved.branch_id, Some(second));
        assert_eq!(saved.assigned_by.as_deref(), Some("second-manager"));
    }
}
