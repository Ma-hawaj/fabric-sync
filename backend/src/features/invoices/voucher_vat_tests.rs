//! Bahrain NBR Retail and Wholesale Guide, sections 13.1 and 18.5.
use super::{document, service, types::CreateInvoiceInput};
use crate::{error::AppError, test_support};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

fn input(value: Value) -> CreateInvoiceInput {
    serde_json::from_value(value).unwrap()
}

async fn product(pool: &PgPool) -> (Uuid, Uuid) {
    let branch: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock) VALUES('Voucher test',true) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let product: Uuid = sqlx::query_scalar(
        "INSERT INTO products(name,unit_price) VALUES('Shirt',110) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,100)")
        .bind(product)
        .bind(branch)
        .execute(pool)
        .await
        .unwrap();
    test_support::open_branch(pool, branch).await;
    (product, branch)
}

fn merchandise(product: Uuid, branch: Uuid, price: f64, code: &str, redeemed: f64) -> Value {
    json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount",
        "products":[{"productId":product,"branchId":branch,"quantity":1,"unitPrice":price}],
        "giftCardRedemptions":[{"code":code,"amount":redeemed}]})
}

/// Ensure demo funding has sale provenance and its redemption documents match saved tax.
#[sqlx::test]
async fn demo_paid_cards_have_issuance_invoices_and_consistent_tax_snapshots(pool: PgPool) {
    crate::seed::run_reference_data(&pool).await.unwrap();
    crate::seed::run(&pool).await.unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    for code in [
        "GC-7KMP-4RWT-9DXH",
        "GC-8BNQ-5SVX-3FYJ",
        "GC-6CZR-2HKT-8WPM",
    ] {
        let card = crate::features::gift_cards::service::get_gift_card_by_code(&state, code)
            .await
            .unwrap();
        assert!(card.taxed_at_issue, "{code}");
    }
    let mismatches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices WHERE taxable_amount + vat_amount <> total_price - gift_card_redeemed")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(mismatches, 0);
    let receipt = service::get_invoice(
        &state,
        "019a0000-0008-7000-8000-000000000009".parse().unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(receipt.document_kind, "redemption_receipt");
    assert_eq!(receipt.totals.vat, 0.0);
}

#[sqlx::test]
async fn issue_partial_redemption_and_final_redemption_tax_value_exactly_once(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (product, branch) = product(&pool).await;
    let sale = service::create_invoice(
        &state,
        input(
            json!({"issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount",
        "giftCards":[{"amount":110,"recipientPhone":"33112233"}]}),
        ),
        "staff",
    )
    .await
    .unwrap();
    let code = &sale.gift_cards[0].code;
    let card = crate::features::gift_cards::service::get_gift_card_by_code(&state, code)
        .await
        .unwrap();
    assert!(card.taxed_at_issue);
    let issued = service::get_invoice(&state, sale.id).await.unwrap();
    assert_eq!(
        (
            issued.totals.total,
            issued.totals.taxable,
            issued.totals.vat,
            issued.totals.sales_amount
        ),
        (110.0, 100.0, 10.0, 0.0)
    );
    assert!(issued.lines[0].taxable);
    let issue_html = document::render_invoice_document(&state, sale.id)
        .await
        .unwrap();
    assert!(issue_html.contains("Single-purpose gift card"));
    assert!(issue_html.contains(code));

    // 55 of prepaid value + 22 of new consideration: only the 22 holds new VAT.
    let partial_payload = merchandise(product, branch, 77.0, code, 55.0);
    let partial = service::create_invoice(&state, input(partial_payload.clone()), "staff")
        .await
        .unwrap();
    let detail = service::get_invoice(&state, partial.id).await.unwrap();
    assert_eq!(
        (
            detail.totals.total,
            detail.totals.taxable,
            detail.totals.vat,
            detail.totals.prepaid_amount,
            detail.totals.balance_due
        ),
        (77.0, 20.0, 2.0, 55.0, 22.0)
    );
    assert_eq!(detail.document_kind, "tax_invoice");
    let html = document::render_invoice_document(&state, partial.id)
        .await
        .unwrap();
    assert!(html.contains("Gift-card value already taxed at issue"));
    assert!(html.contains(code));

    // Editing a redemption retains the policy, tax snapshot and original tender.
    let edit = service::get_invoice_for_edit(&state, partial.id)
        .await
        .unwrap();
    let mut edited = partial_payload;
    edited["products"][0]["originalItemId"] = json!(edit.products[0].original_item_id);
    service::update_invoice(&state, partial.id, input(edited))
        .await
        .unwrap();
    assert_eq!(
        service::get_invoice(&state, partial.id)
            .await
            .unwrap()
            .totals
            .vat,
        2.0
    );

    let full = service::create_invoice(
        &state,
        input(merchandise(product, branch, 55.0, code, 55.0)),
        "staff",
    )
    .await
    .unwrap();
    let detail = service::get_invoice(&state, full.id).await.unwrap();
    assert_eq!(
        (
            detail.totals.taxable,
            detail.totals.vat,
            detail.totals.balance_due
        ),
        (0.0, 0.0, 0.0)
    );
    assert_eq!(detail.document_kind, "redemption_receipt");
    let html = document::render_invoice_document(&state, full.id)
        .await
        .unwrap();
    assert!(html.contains("Gift Card Redemption Receipt"));
    assert!(!html.contains("<span class=\"en\">Tax Invoice</span>"));
    // 110 voucher funding + 132 merchandise transactions produce only 120 net sales.
    let sales: f64 =
        sqlx::query_scalar("SELECT SUM(sales_amount)::float8 FROM invoice_voucher_accounting")
            .fetch_one(&pool)
            .await
            .unwrap();
    let vat: f64 = sqlx::query_scalar("SELECT SUM(vat_amount)::float8 FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((sales, vat), (120.0, 12.0));
    let page = service::list_invoices(&state, &Default::default())
        .await
        .unwrap();
    assert_eq!(page.total, 3);
}

#[sqlx::test]
async fn uninvoiced_credit_settles_the_purchase_without_removing_vat(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (product, branch) = product(&pool).await;
    let comp = crate::features::gift_cards::service::create_gift_card(
        &state,
        serde_json::from_value(json!({"amount":55,"recipientPhone":"33112233"})).unwrap(),
        "test-staff",
    )
    .await
    .unwrap();
    assert!(!comp.taxed_at_issue);
    assert_eq!(comp.issued_by.as_deref(), Some("test-staff"));
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(before, 0);
    let mut payload = merchandise(product, branch, 55.0, &comp.code, 55.0);
    // Neither a forged preview flag nor a forged prepaid amount changes tax.
    payload["giftCardRedemptions"][0]["taxedAtIssue"] = json!(true);
    payload["prepaidAmount"] = json!(55);
    let created = service::create_invoice(&state, input(payload.clone()), "staff")
        .await
        .unwrap();
    let detail = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(detail.document_kind, "tax_invoice");
    assert_eq!(detail.payment_status, "paid");
    assert_eq!(
        (
            detail.totals.total,
            detail.totals.taxable,
            detail.totals.vat,
            detail.totals.prepaid_amount,
            detail.totals.balance_due,
            detail.totals.sales_amount
        ),
        (55.0, 50.0, 5.0, 0.0, 0.0, 50.0)
    );
    let html = document::render_invoice_document(&state, created.id)
        .await
        .unwrap();
    assert!(html.contains("<span class=\"en\">Tax Invoice</span>"));
    assert!(!html.contains("Gift Card Redemption Receipt"));
    assert!(!html.contains("Gift-card value already taxed at issue"));

    let edit = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    assert!(!edit.gift_card_redemptions[0].taxed_at_issue);
    payload["products"][0]["originalItemId"] = json!(edit.products[0].original_item_id);
    service::update_invoice(&state, created.id, input(payload))
        .await
        .unwrap();
    let edited = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(
        (
            edited.totals.taxable,
            edited.totals.vat,
            edited.totals.prepaid_amount
        ),
        (50.0, 5.0, 0.0)
    );
    let card = crate::features::gift_cards::service::get_gift_card_by_code(&state, &comp.code)
        .await
        .unwrap();
    assert_eq!(card.balance, 0.0);
    assert_eq!(card.issued_by, comp.issued_by);
    let stock: f64 = sqlx::query_scalar(
        "SELECT quantity::float8 FROM product_stock WHERE product_id=$1 AND branch_id=$2",
    )
    .bind(product)
    .bind(branch)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stock, 99.0);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test]
async fn mixed_paid_and_uninvoiced_cards_exclude_only_prepaid_value(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (product, branch) = product(&pool).await;
    let paid = service::create_invoice(
        &state,
        input(json!({
            "issuingBranchId":branch,"expectedVatRate":0.1,"discountUnit":"amount",
            "giftCards":[{"amount":110,"recipientPhone":"33112233"}]
        })),
        "seller",
    )
    .await
    .unwrap();
    let comp = crate::features::gift_cards::service::create_gift_card(
        &state,
        serde_json::from_value(json!({"amount":55,"recipientPhone":"33112233"})).unwrap(),
        "issuer",
    )
    .await
    .unwrap();
    let mut payload = merchandise(product, branch, 132.0, &paid.gift_cards[0].code, 55.0);
    payload["giftCardRedemptions"][0]["taxedAtIssue"] = json!(false);
    payload["giftCardRedemptions"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "code":comp.code,"amount":55,"taxedAtIssue":true
        }));
    let created = service::create_invoice(&state, input(payload.clone()), "staff")
        .await
        .unwrap();
    let detail = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(
        (
            detail.totals.prepaid_amount,
            detail.totals.taxable,
            detail.totals.vat,
            detail.totals.gift_card_redeemed,
            detail.totals.balance_due
        ),
        (55.0, 70.0, 7.0, 110.0, 22.0)
    );
    let edit = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    assert!(
        edit.gift_card_redemptions
            .iter()
            .find(|r| r.code == paid.gift_cards[0].code)
            .unwrap()
            .taxed_at_issue
    );
    assert!(
        !edit
            .gift_card_redemptions
            .iter()
            .find(|r| r.code == comp.code)
            .unwrap()
            .taxed_at_issue
    );

    // Removing standalone credit restores its balance, while the unchanged
    // paid redemption retains its prepaid treatment during the rebuild.
    payload["products"][0]["originalItemId"] = json!(edit.products[0].original_item_id);
    payload["giftCardRedemptions"].as_array_mut().unwrap().pop();
    service::update_invoice(&state, created.id, input(payload))
        .await
        .unwrap();
    let edited = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(
        (
            edited.totals.prepaid_amount,
            edited.totals.vat,
            edited.totals.balance_due
        ),
        (55.0, 7.0, 77.0)
    );
    let restored = crate::features::gift_cards::service::get_gift_card_by_code(&state, &comp.code)
        .await
        .unwrap();
    assert_eq!(restored.balance, 55.0);
}

/// A later expired card must roll back earlier credit spending and merchandise stock changes.
#[sqlx::test]
async fn invalid_uninvoiced_card_rolls_back_all_tender_stock_and_invoice_writes(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let (product, branch) = product(&pool).await;
    let mut cards = Vec::new();
    for expires_on in [None, Some("2020-01-01")] {
        cards.push(
            crate::features::gift_cards::service::create_gift_card(
                &state,
                serde_json::from_value(
                    json!({"amount":55,"recipientPhone":"33112233","expiresOn":expires_on}),
                )
                .unwrap(),
                "issuer",
            )
            .await
            .unwrap(),
        );
    }
    let mut payload = merchandise(product, branch, 110.0, &cards[0].code, 55.0);
    payload["giftCardRedemptions"]
        .as_array_mut()
        .unwrap()
        .push(json!({"code":cards[1].code,"amount":55}));
    let result = service::create_invoice(&state, input(payload), "staff").await;
    assert!(matches!(result, Err(AppError::BadRequest(message)) if message.contains("expired")));
    for card in cards {
        assert_eq!(
            crate::features::gift_cards::service::get_gift_card_by_code(&state, &card.code)
                .await
                .unwrap()
                .balance,
            55.0
        );
    }
    let invoices: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    let stock: f64 = sqlx::query_scalar(
        "SELECT quantity::float8 FROM product_stock WHERE product_id=$1 AND branch_id=$2",
    )
    .bind(product)
    .bind(branch)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((invoices, stock), (0, 100.0));
}
