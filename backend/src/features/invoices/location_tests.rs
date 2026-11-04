use super::{service, types::CreateInvoiceInput};
use crate::{error::AppError, test_support};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test]
async fn issuing_branch_and_delivery_address_survive_edits_independently(pool: PgPool) {
    let (_, _, stock, _) = test_support::invoice(&pool, 0, false).await;
    let issuer: Uuid =
        sqlx::query_scalar("INSERT INTO branch(name) VALUES('Issuing office') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let product: Uuid =
        sqlx::query_scalar("INSERT INTO products(name,unit_price) VALUES('Shirt',20) RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,10)")
        .bind(product)
        .bind(stock)
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut payload = json!({
        "expectedVatRate": 0.1, "discountUnit": "amount", "issuingBranchId": issuer,
        "branchId": stock, "collectionMethod": "delivery", "deliveryAddress": "  Building 2 <Road 3>  ",
        "products": [{ "productId": product, "branchId": stock, "quantity": 1, "unitPrice": 20 }]
    });
    let created = service::create_invoice(
        &state,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let saved = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    assert_eq!(saved.issuing_branch_id, Some(issuer));
    assert_eq!(saved.branch_id, None);
    assert_eq!(
        saved.delivery_address.as_deref(),
        Some("Building 2 <Road 3>")
    );
    let html = super::document::render_invoice_document(&state, created.id)
        .await
        .unwrap();
    assert!(html.contains("Issuing branch"));
    assert!(html.contains("Building 2 &lt;Road 3&gt;"));
    assert!(!html.contains("Collection branch"));
    sqlx::query("UPDATE branch SET name='Renamed office',is_active=false WHERE id=$1")
        .bind(issuer)
        .execute(&pool)
        .await
        .unwrap();
    payload["collectionMethod"] = json!("pickup");
    service::update_invoice(
        &state,
        created.id,
        serde_json::from_value(payload.clone()).unwrap(),
    )
    .await
    .unwrap();
    let detail = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(
        detail.issuing_branch_name.as_deref(),
        Some("Issuing office")
    );
    assert_eq!(detail.delivery_address, None);
    assert!(detail.branch_name.is_some());
    let input: CreateInvoiceInput = serde_json::from_value(payload.clone()).unwrap();
    assert!(matches!(
        service::create_invoice(&state, input, "staff").await,
        Err(AppError::BadRequest(_))
    ));
    payload["issuingBranchId"] = json!(stock);
    payload["collectionMethod"] = json!("delivery");
    payload["deliveryAddress"] = json!("   ");
    assert!(matches!(
        service::create_invoice(&state, serde_json::from_value(payload).unwrap(), "staff").await,
        Err(AppError::BadRequest(_))
    ));
}
