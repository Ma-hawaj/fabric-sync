use super::{service, types::CreateInvoiceInput};
use crate::test_support;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test]
async fn invoice_creator_and_initial_payment_actor_survive_edits(pool: PgPool) {
    let (imported, _, branch, _) = test_support::invoice(&pool, 0, false).await;
    let product: Uuid = sqlx::query_scalar(
        "INSERT INTO products(name,unit_price) VALUES('Cotton shirt',100) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,10)")
        .bind(product)
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    let mut payload = json!({
        "discountUnit":"amount", "createdBy":"forged-client-creator",
        "products":[{"productId":product,"branchId":branch,"quantity":1,"unitPrice":100}],
        "payments":[{"amount":25,"paymentType":"cash","recordedBy":"forged-client-recorder"}]
    });
    let state = test_support::state(pool.clone(), None, None).await;
    let input: CreateInvoiceInput = serde_json::from_value(payload.clone()).unwrap();
    let created = service::create_invoice(&state, input, "original-creator")
        .await
        .unwrap();
    let before = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(before.created_by.as_deref(), Some("original-creator"));
    assert_eq!(
        before.payments[0].recorded_by.as_deref(),
        Some("original-creator")
    );
    payload["createdBy"] = json!("editor-cannot-replace-creator");
    payload["products"][0]["quantity"] = json!(2);
    service::update_invoice(&state, created.id, serde_json::from_value(payload).unwrap())
        .await
        .unwrap();
    let after = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(after.created_by, before.created_by);
    assert_eq!(after.payments[0].id, before.payments[0].id);
    assert_eq!(
        after.payments[0].recorded_by,
        before.payments[0].recorded_by
    );
    let page = service::list_invoices(&state, &Default::default())
        .await
        .unwrap();
    assert_eq!(
        page.data
            .iter()
            .find(|row| row.id == created.id)
            .unwrap()
            .created_by
            .as_deref(),
        Some("original-creator")
    );
    assert!(page
        .data
        .iter()
        .find(|row| row.id == imported)
        .unwrap()
        .created_by
        .is_none());
    assert!(service::get_invoice(&state, imported)
        .await
        .unwrap()
        .created_by
        .is_none());
}
