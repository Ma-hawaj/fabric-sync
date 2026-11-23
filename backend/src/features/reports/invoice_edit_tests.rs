use chrono::{Days, NaiveDate, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use super::{day_service, service, till_service};
use crate::{
    error::AppError,
    features::invoices::{service as invoices, types::CreateInvoiceInput},
    test_support,
};

fn today() -> NaiveDate {
    Utc::now()
        .with_timezone(&chrono_tz::Asia::Bahrain)
        .date_naive()
}

async fn cross_day_edit(pool: PgPool, prepaid: bool) {
    let branch: Uuid = sqlx::query_scalar("INSERT INTO branch(name,holds_stock,daily_check_required) VALUES('Cross-day branch',true,false) RETURNING id").fetch_one(&pool).await.unwrap();
    let product: Uuid = sqlx::query_scalar(
        "INSERT INTO products(name,unit_price) VALUES('Shirt',110) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,100)")
        .bind(product)
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let (card, code) = if prepaid {
        let sale = invoices::create_invoice(&state,serde_json::from_value(json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":100,"recipientPhone":"33112233"}]})).unwrap(),"original-staff").await.unwrap();
        (sale.gift_cards[0].id, sale.gift_cards[0].code.clone())
    } else {
        let code = "GC-7KMP-4RWT-9DXH".to_string();
        let card = sqlx::query_scalar(
            "INSERT INTO gift_cards(code,initial_amount,balance) VALUES($1,100,100) RETURNING id",
        )
        .bind(&code)
        .fetch_one(&pool)
        .await
        .unwrap();
        (card, code)
    };
    let mut payload = json!({
        "issuingBranchId":branch,"branchId":branch,"expectedVatRate":0.1,"discountUnit":"amount",
        "products":[{"productId":product,"branchId":branch,"quantity":1,"unitPrice":110}],
        "giftCardRedemptions":[{"code":code,"amount":20}],
        "payments":[{"amount":20,"paymentType":"cash"}]
    });
    let created = invoices::create_invoice(
        &state,
        serde_json::from_value(payload.clone()).unwrap(),
        "original-staff",
    )
    .await
    .unwrap();
    let old = today().checked_sub_days(Days::new(2)).unwrap();
    let issued = service::day_bounds(old, chrono_tz::Asia::Bahrain)
        .unwrap()
        .0
        + chrono::Duration::hours(9);
    // This fixture represents issuance and payments on the earlier business day.
    sqlx::query(
        "UPDATE invoices SET invoice_date=$2 WHERE COALESCE(issuing_branch_id,branch_id)=$1",
    )
    .bind(branch)
    .bind(issued)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE invoice_payments SET paid_at=$2 WHERE invoice_id=$1")
        .bind(created.id)
        .bind(issued)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE gift_card_redemptions SET redeemed_at=$2 WHERE invoice_id=$1")
        .bind(created.id)
        .bind(issued)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_cash_openings(branch_id,business_date,amount,recorded_by,request_id,request_hash) VALUES($1,$2,50,'fixture',uuidv7(),decode(repeat('00',32),'hex'))").bind(branch).bind(old).execute(&pool).await.unwrap();
    sqlx::query("UPDATE branch SET daily_check_required=true WHERE id=$1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let original = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    day_service::close_day(&state,serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"branchId":branch,"date":old,"fingerprint":original.fingerprint,
        "counts":{"branchActivityConfirmed":true,"openingCash":50,"cashAdded":0,"cashRemoved":0,"actualCash":70,"actualBenefit":0,"actualCard":0,"notes":"Counted before the next opening after the evening close was missed."}
    })).unwrap(),"closing-staff").await.unwrap();
    till_service::save_opening(
        &state,
        serde_json::from_value(
            json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":today(),"amount":70}),
        )
        .unwrap(),
        None,
        "opening-staff",
    )
    .await
    .unwrap();
    let frozen_before: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM branch_day_closures c WHERE branch_id=$1 AND business_date=$2",
    )
    .bind(branch)
    .bind(old)
    .fetch_one(&pool)
    .await
    .unwrap();
    let payments_before: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM invoice_payments p WHERE invoice_id=$1",
    )
    .bind(created.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let redemptions_before:Value=sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM gift_card_redemptions r WHERE invoice_id=$1").bind(created.id).fetch_one(&pool).await.unwrap();
    let editing = invoices::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    payload["products"][0]["originalItemId"] = json!(editing.products[0].original_item_id);
    payload["giftCardRedemptions"][0]["amount"] = json!(30);
    assert!(
        matches!(invoices::update_invoice(&state,created.id,serde_json::from_value(payload.clone()).unwrap()).await,Err(AppError::Conflict(message)) if message.contains("gift-card payments"))
    );
    payload["giftCardRedemptions"][0]["amount"] = json!(20);
    payload["products"][0]["unitPrice"] = json!(35);
    assert!(matches!(
        invoices::update_invoice(
            &state,
            created.id,
            serde_json::from_value(payload.clone()).unwrap()
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    payload["products"][0]["quantity"] = json!(2);
    payload["products"][0]["unitPrice"] = json!(120);
    payload["giftCardRedemptions"][0]["code"] = json!(code.to_ascii_lowercase());
    payload["payments"] = json!([{"amount":999,"paymentType":"card"}]);
    payload["targetDate"] = json!("2099-01-01");
    let saved = invoices::update_invoice(
        &state,
        created.id,
        serde_json::from_value(payload.clone()).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(saved.total_price, 240.0);
    let invoice = invoices::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(invoice.created_by.as_deref(), Some("original-staff"));
    assert_eq!(invoice.totals.vat_rate, 0.1);
    assert_eq!(invoice.totals.vat, if prepaid { 20.0 } else { 21.82 });
    let kept_date: chrono::DateTime<Utc> =
        sqlx::query_scalar("SELECT invoice_date FROM invoices WHERE id=$1")
            .bind(created.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kept_date, issued);
    let stock: f64 = sqlx::query_scalar(
        "SELECT quantity::float8 FROM product_stock WHERE product_id=$1 AND branch_id=$2",
    )
    .bind(product)
    .bind(branch)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stock, 98.0);
    let balance: f64 = sqlx::query_scalar("SELECT balance::float8 FROM gift_cards WHERE id=$1")
        .bind(card)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 80.0);
    let payments_after: Value = sqlx::query_scalar(
        "SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM invoice_payments p WHERE invoice_id=$1",
    )
    .bind(created.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(payments_after, payments_before);
    let redemptions_after:Value=sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM gift_card_redemptions r WHERE invoice_id=$1").bind(created.id).fetch_one(&pool).await.unwrap();
    assert_eq!(redemptions_after, redemptions_before);
    let frozen_after: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM branch_day_closures c WHERE branch_id=$1 AND business_date=$2",
    )
    .bind(branch)
    .bind(old)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(frozen_after, frozen_before);
    let historical = service::sales_closing(&state, Some(old), branch)
        .await
        .unwrap();
    assert_eq!(historical.fingerprint, original.fingerprint);
    assert_eq!(
        historical.summary.invoice_total,
        original.summary.invoice_total
    );
    let current = service::sales_closing(&state, Some(today()), branch)
        .await
        .unwrap();
    assert_eq!(current.summary.invoice_count, 0);
    assert_eq!(current.summary.invoice_payments, 0.0);
    assert_eq!(current.summary.gift_card_redemptions, 0.0);
    // Closing today's branch still blocks edits; cross-day eligibility is not
    // an escape from the branch's trading requirements.
    day_service::close_day(&state,serde_json::from_value(json!({
        "requestId":Uuid::new_v4(),"branchId":branch,"date":today(),"fingerprint":current.fingerprint,
        "counts":{"branchActivityConfirmed":true,"openingCash":70,"cashAdded":0,"cashRemoved":0,"actualCash":70,"actualBenefit":0,"actualCard":0,"notes":""}
    })).unwrap(),"closing-staff").await.unwrap();
    assert!(
        matches!(invoices::update_invoice(&state,created.id,serde_json::from_value(payload).unwrap()).await,Err(AppError::Conflict(message)) if message.contains("closed for today"))
    );
}

#[sqlx::test]
async fn older_draft_edits_keep_credit_tender_payments_and_closed_reports(pool: PgPool) {
    cross_day_edit(pool, false).await;
}

#[sqlx::test]
async fn older_draft_edits_keep_prepaid_tender_tax_provenance_and_closed_reports(pool: PgPool) {
    cross_day_edit(pool, true).await;
}

#[sqlx::test]
async fn older_drafts_still_require_an_open_branch_and_preserve_other_edit_guards(pool: PgPool) {
    let (invoice, orders, _, branch) = test_support::invoice(&pool, 1, false).await;
    let old = today().pred_opt().unwrap();
    sqlx::query("UPDATE invoices SET invoice_date=$2 WHERE id=$1")
        .bind(invoice)
        .bind(
            service::day_bounds(old, chrono_tz::Asia::Bahrain)
                .unwrap()
                .0,
        )
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state_without_openings(pool.clone(), None, None).await;
    let payload = json!({"issuingBranchId":branch,"branchId":branch,"expectedVatRate":0.1,"discountUnit":"amount","giftCards":[{"amount":110,"recipientPhone":"33112233"}]});
    let input = || serde_json::from_value::<CreateInvoiceInput>(payload.clone()).unwrap();
    assert!(
        matches!(invoices::update_invoice(&state,invoice,input()).await,Err(AppError::Conflict(message)) if message.contains("opening cash"))
    );
    till_service::save_opening(
        &state,
        serde_json::from_value(
            json!({"requestId":Uuid::new_v4(),"branchId":branch,"date":today(),"amount":0}),
        )
        .unwrap(),
        None,
        "staff",
    )
    .await
    .unwrap();
    let other: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Other issuer') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut moved = payload.clone();
    moved["issuingBranchId"] = json!(other);
    assert!(
        matches!(invoices::update_invoice(&state,invoice,serde_json::from_value(moved).unwrap()).await,Err(AppError::Conflict(message)) if message.contains("issuing branch"))
    );
    sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        matches!(invoices::update_invoice(&state,invoice,input()).await,Err(AppError::BadRequest(message)) if message.contains("collected"))
    );
    sqlx::query("UPDATE orders SET status='pending',collected_at=NULL WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO order_repairs(order_id,reason,status) VALUES($1,'Existing repair','open')",
    )
    .bind(orders[0])
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        matches!(invoices::update_invoice(&state,invoice,input()).await,Err(AppError::BadRequest(message)) if message.contains("production"))
    );
}
