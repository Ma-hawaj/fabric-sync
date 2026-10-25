use super::{service, types::CreateReturnInput};
use crate::{
    error::AppError,
    features::invoices::{service as invoices, types::CreateInvoiceInput},
    state::AppState,
    test_support,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

struct Sale {
    state: AppState,
    invoice: Uuid,
    material: Uuid,
    item: Uuid,
    origin: Uuid,
    destination: Uuid,
}

async fn sale(pool: &PgPool, mixed: bool, paid: bool) -> Sale {
    let state = test_support::state(pool.clone(), None, None).await;
    let origin = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock) VALUES('Fabric sale',true) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let destination = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock) VALUES('Fabric returns',true) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let material = sqlx::query_scalar("INSERT INTO materials(name,unit,junior_price,normal_price,large_price) VALUES('Linen','meters',22,22,22) RETURNING id").fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,10)")
        .bind(material)
        .bind(origin)
        .execute(pool)
        .await
        .unwrap();
    let mut input = json!({"discountUnit":"percent","discount":if mixed {10} else {0},
        "materials":[{"materialId":material,"branchId":origin,"quantity":2.5,"unitPrice":11}]});
    if mixed {
        let product: Uuid = sqlx::query_scalar(
            "INSERT INTO products(name,unit_price) VALUES('Buttons',10) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,5)")
            .bind(product)
            .bind(origin)
            .execute(pool)
            .await
            .unwrap();
        input["products"] =
            json!([{"productId":product,"branchId":origin,"quantity":3,"unitPrice":10}]);
    }
    if paid {
        input["payments"] = json!([{"amount":if mixed {51.75} else {27.5},"paymentType":"cash"}]);
    }
    let invoice = invoices::create_invoice(&state, serde_json::from_value(input).unwrap(), "staff")
        .await
        .unwrap()
        .id;
    let item =
        sqlx::query_scalar("SELECT id FROM invoice_items WHERE invoice_id=$1 AND kind='material'")
            .bind(invoice)
            .fetch_one(pool)
            .await
            .unwrap();
    Sale {
        state,
        invoice,
        material,
        item,
        origin,
        destination,
    }
}

fn request(sale: &Sale, quantity: f64, restock: bool) -> Value {
    json!({"requestId":Uuid::new_v4(),"reason":"Unused fabric",
        "lines":[{"lineId":sale.item,"quantity":quantity,"restock":restock,
            "restockLocationId":if restock {Some(sale.destination)} else {None}}]})
}
async fn submit(sale: &Sale, payload: Value) -> Result<super::types::RecordedAdjustment, AppError> {
    service::create_return(
        &sale.state,
        sale.invoice,
        serde_json::from_value::<CreateReturnInput>(payload).unwrap(),
        "staff",
    )
    .await
}
async fn stock(pool: &PgPool, sale: &Sale, branch: Uuid) -> f64 {
    sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0)::float8 FROM material_stock WHERE material_id=$1 AND branch_id=$2").bind(sale.material).bind(branch).fetch_one(pool).await.unwrap()
}

#[sqlx::test]
async fn mixed_material_and_product_returns_allocate_discount_and_restock_fractional_fabric(
    pool: PgPool,
) {
    let sale = sale(&pool, true, false).await;
    let context = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(context.settlement.net_total, 51.75);
    assert_eq!(context.lines.len(), 2);
    let material = context
        .lines
        .iter()
        .find(|line| line.kind == "material")
        .unwrap();
    assert_eq!(material.unit.as_deref(), Some("meters"));
    assert_eq!(material.credit_limit, 24.75);
    assert!(material.can_restock);
    assert_eq!(material.default_restock_location_id, Some(sale.origin));
    let product = context
        .lines
        .iter()
        .find(|line| line.kind == "product")
        .unwrap();
    assert_eq!(product.credit_limit, 27.0);

    let first = request(&sale, 1.25, true);
    let recorded = submit(&sale, first.clone()).await.unwrap();
    assert_eq!(submit(&sale, first).await.unwrap().id, recorded.id);
    let after = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(after.returns.len(), 1);
    assert_eq!(after.returns[0].amount, 12.38);
    assert_eq!(
        after.returns[0].lines.0[0].original_location_id,
        Some(sale.origin)
    );
    assert_eq!(
        after.returns[0].lines.0[0].restock_location_id,
        Some(sale.destination)
    );
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.5);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 1.25);
    submit(&sale, request(&sale, 1.25, true)).await.unwrap();
    assert!(submit(&sale, request(&sale, 0.01, true)).await.is_err());
    assert_eq!(stock(&pool, &sale, sale.destination).await, 2.5);
    let product_return = json!({"requestId":Uuid::new_v4(),"reason":"Buttons unused","lines":[{"lineId":product.line_id,"quantity":3,"restock":false}]});
    submit(&sale, product_return).await.unwrap();
    let after = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(after.settlement.amount_credited, 51.75);
    assert_eq!(after.settlement.net_total, 0.0);
    assert_eq!(after.settlement.balance_due, 0.0);
    assert_eq!(
        after.returns.iter().map(|entry| entry.amount).sum::<f64>(),
        51.75
    );
    let input: CreateInvoiceInput = serde_json::from_value(json!({"discountUnit":"amount","materials":[{"materialId":sale.material,"branchId":sale.origin,"quantity":1,"unitPrice":11}]})).unwrap();
    assert!(invoices::update_invoice(&sale.state, sale.invoice, input)
        .await
        .is_err());
}

#[sqlx::test]
async fn material_cash_refunds_are_atomic_and_can_skip_restocking(pool: PgPool) {
    let sale = sale(&pool, false, true).await;
    let mut payload = request(&sale, 1.0, true);
    payload["refund"] = json!({"timing":"now","payments":[{"amount":10,"paymentType":"cash"}]});
    assert!(submit(&sale, payload.clone()).await.is_err());
    let context = service::context(&sale.state, sale.invoice).await.unwrap();
    assert!(context.returns.is_empty());
    assert!(context.refunds.is_empty());
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.5);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 0.0);
    payload["lines"][0]["restock"] = json!(false);
    payload["lines"][0]["restockLocationId"] = Value::Null;
    payload["refund"]["payments"][0]["amount"] = json!(11);
    submit(&sale, payload.clone()).await.unwrap();
    submit(&sale, payload).await.unwrap();
    let after = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(after.returns.len(), 1);
    assert_eq!(after.refunds.len(), 1);
    assert_eq!(after.settlement.cash_refunded, 11.0);
    assert_eq!(after.settlement.net_total, 16.5);
    assert_eq!(after.settlement.refund_due, 0.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 0.0);
}

#[sqlx::test]
async fn material_returns_validate_destinations_and_serialize_concurrent_quantities(pool: PgPool) {
    let sale = sale(&pool, false, false).await;
    let inactive: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock,is_active) VALUES('Inactive',true,false) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let pickup: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,holds_stock) VALUES('Pickup',false) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    for destination in [
        Value::Null,
        json!(inactive),
        json!(pickup),
        json!(Uuid::new_v4()),
    ] {
        let mut payload = request(&sale, 1.0, true);
        payload["lines"][0]["restockLocationId"] = destination;
        assert!(submit(&sale, payload).await.is_err());
    }
    for quantity in [0.0, -1.0, 0.001, 2.51] {
        assert!(submit(&sale, request(&sale, quantity, true)).await.is_err());
    }
    assert!(service::context(&sale.state, sale.invoice)
        .await
        .unwrap()
        .returns
        .is_empty());
    let (a, b) = tokio::join!(
        submit(&sale, request(&sale, 2.0, true)),
        submit(&sale, request(&sale, 2.0, true))
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(stock(&pool, &sale, sale.destination).await, 2.0);
    let context = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(context.lines[0].returned_quantity, 2.0);
    assert_eq!(context.settlement.amount_credited, 22.0);
}

#[sqlx::test]
async fn material_returns_restore_original_gift_card_tender(pool: PgPool) {
    let sale = sale(&pool, false, false).await;
    let card: Uuid = sqlx::query_scalar("INSERT INTO gift_cards(code,initial_amount,balance) VALUES('MATERIAL-REFUND',27.5,0) RETURNING id").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE invoices SET gift_card_redeemed=27.5 WHERE id=$1")
        .bind(sale.invoice)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO gift_card_redemptions(gift_card_id,invoice_id,amount) VALUES($1,$2,27.5)",
    )
    .bind(card)
    .bind(sale.invoice)
    .execute(&pool)
    .await
    .unwrap();
    let mut payload = request(&sale, 2.5, true);
    payload["refund"] = json!({"timing":"now","payments":[{"amount":27.5,"paymentType":"gift_card","giftCardId":card}]});
    submit(&sale, payload.clone()).await.unwrap();
    submit(&sale, payload).await.unwrap();
    let balance: f64 = sqlx::query_scalar("SELECT balance::float8 FROM gift_cards WHERE id=$1")
        .bind(card)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, 27.5);
    let after = service::context(&sale.state, sale.invoice).await.unwrap();
    assert_eq!(after.settlement.gift_card_refunded, 27.5);
    assert_eq!(after.settlement.refund_due, 0.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 2.5);
}

#[sqlx::test]
async fn cancelling_an_urgent_order_does_not_consume_the_material_sale_credit(pool: PgPool) {
    let sale = sale(&pool, false, false).await;
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Buyer','33112233') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let input = json!({"targetDate":"2099-01-01","discount":10,"discountUnit":"percent",
        "materials":[{"materialId":sale.material,"branchId":sale.origin,"quantity":2.5,"unitPrice":11}],
        "customers":[{"existingCustomerId":customer,"measurement":{"date":"2026-10-25","type":"body","fit":"medium"},
            "orders":[{"materialId":sale.material,"productionLocationId":sale.origin,"materialAmount":2,"isUrgent":true}]}]});
    let invoice =
        invoices::create_invoice(&sale.state, serde_json::from_value(input).unwrap(), "staff")
            .await
            .unwrap()
            .id;
    let order: Uuid = sqlx::query_scalar("SELECT id FROM orders WHERE invoice_id=$1")
        .bind(invoice)
        .fetch_one(&pool)
        .await
        .unwrap();
    service::cancel_order(
        &sale.state,
        order,
        serde_json::from_value(json!({"requestId":Uuid::new_v4(),"reason":"No tailoring needed"}))
            .unwrap(),
        "staff",
    )
    .await
    .unwrap();
    let context = service::context(&sale.state, invoice).await.unwrap();
    assert_eq!(context.settlement.amount_credited, 24.8);
    let material = context
        .lines
        .iter()
        .find(|line| line.kind == "material")
        .unwrap();
    assert_eq!(material.credit_limit, 24.75);
    service::create_return(&sale.state,invoice,serde_json::from_value(json!({"requestId":Uuid::new_v4(),"reason":"Return unused fabric","lines":[{"lineId":material.line_id,"quantity":2.5,"restock":false}]})).unwrap(),"staff").await.unwrap();
    let after = service::context(&sale.state, invoice).await.unwrap();
    assert_eq!(after.settlement.amount_credited, 49.55);
    assert_eq!(after.settlement.net_total, 0.0);
}
