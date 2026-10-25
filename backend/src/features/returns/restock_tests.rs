use super::{service, types::CreateReturnInput};
use crate::{error::AppError, test_support};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

struct Sale {
    invoice: Uuid,
    product: Uuid,
    item: Uuid,
    origin: Uuid,
    destination: Uuid,
}

async fn sale(pool: &PgPool) -> Sale {
    let (invoice, _, origin, _) = test_support::invoice(pool, 0, false).await;
    sqlx::query("UPDATE invoices SET total_price=30 WHERE id=$1")
        .bind(invoice)
        .execute(pool)
        .await
        .unwrap();
    let destination: Uuid = sqlx::query_scalar("INSERT INTO branch(name,is_active,holds_stock) VALUES('Return counter',true,true) RETURNING id").fetch_one(pool).await.unwrap();
    let product: Uuid = sqlx::query_scalar(
        "INSERT INTO products(name,unit_price) VALUES('Return buttons',10) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO product_stock(product_id,branch_id,quantity) VALUES($1,$2,7)")
        .bind(product)
        .bind(origin)
        .execute(pool)
        .await
        .unwrap();
    let item: Uuid = sqlx::query_scalar("INSERT INTO invoice_items(invoice_id,kind,product_id,branch_id,description,quantity,unit_price,line_total) VALUES($1,'product',$2,$3,'Return buttons',3,10,30) RETURNING id").bind(invoice).bind(product).bind(origin).fetch_one(pool).await.unwrap();
    Sale {
        invoice,
        product,
        item,
        origin,
        destination,
    }
}

fn request(sale: &Sale, quantity: f64) -> Value {
    json!({"requestId":Uuid::new_v4(),"reason":"Unused retail item",
        "lines":[{"lineId":sale.item,"quantity":quantity,"restock":true,"restockLocationId":sale.destination}]})
}

async fn stock(pool: &PgPool, sale: &Sale, location: Uuid) -> f64 {
    sqlx::query_scalar("SELECT COALESCE(SUM(quantity),0)::float8 FROM product_stock WHERE product_id=$1 AND branch_id=$2")
        .bind(sale.product).bind(location).fetch_one(pool).await.unwrap()
}

#[sqlx::test]
async fn return_restocks_the_selected_location_and_exposes_both_locations_in_history(pool: PgPool) {
    let sale = sale(&pool).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let before = service::context(&state, sale.invoice).await.unwrap();
    assert_eq!(
        before.lines[0].default_restock_location_id,
        Some(sale.origin)
    );
    service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(request(&sale, 1.25)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 1.25);
    let after = service::context(&state, sale.invoice).await.unwrap();
    let line = &after.returns[0].lines.0[0];
    assert_eq!(line.original_location_id, Some(sale.origin));
    assert!(line.original_location_name.is_some());
    assert_eq!(line.restock_location_id, Some(sale.destination));
    assert_eq!(
        line.restock_location_name.as_deref(),
        Some("Return counter")
    );
    assert_eq!(line.amount, 12.5);
    assert_eq!(after.settlement.balance_due, 17.5);
}

#[sqlx::test]
async fn return_can_restock_elsewhere_when_the_original_location_is_retired(pool: PgPool) {
    let sale = sale(&pool).await;
    sqlx::query("UPDATE branch SET is_active=false,holds_stock=false WHERE id=$1")
        .bind(sale.origin)
        .execute(&pool)
        .await
        .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let context = service::context(&state, sale.invoice).await.unwrap();
    assert!(context.lines[0].can_restock);
    assert_eq!(context.lines[0].original_location_id, Some(sale.origin));
    assert!(context.lines[0].default_restock_location_id.is_none());
    service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(request(&sale, 1.0)).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 1.0);
}

#[sqlx::test]
async fn invalid_restock_destinations_leave_credit_and_inventory_untouched(pool: PgPool) {
    let sale = sale(&pool).await;
    let inactive: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,is_active,holds_stock) VALUES('Retired',false,true) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let nonstock: Uuid = sqlx::query_scalar("INSERT INTO branch(name,is_active,holds_stock) VALUES('Pickup only',true,false) RETURNING id").fetch_one(&pool).await.unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    for location in [
        Value::Null,
        json!(inactive),
        json!(nonstock),
        json!(Uuid::new_v4()),
    ] {
        let mut payload = request(&sale, 1.0);
        payload["lines"][0]["restockLocationId"] = location;
        let input: CreateReturnInput = serde_json::from_value(payload).unwrap();
        assert!(matches!(
            service::create_return(&state, sale.invoice, input, "staff").await,
            Err(AppError::BadRequest(_))
        ));
    }
    let mut payload = request(&sale, 1.0);
    payload["lines"][0]["restock"] = json!(false);
    assert!(service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(payload).unwrap(),
        "staff"
    )
    .await
    .is_err());
    assert!(service::context(&state, sale.invoice)
        .await
        .unwrap()
        .returns
        .is_empty());
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 0.0);
}

#[sqlx::test]
async fn replay_restock_is_once_only_and_a_changed_destination_conflicts(pool: PgPool) {
    let sale = sale(&pool).await;
    let state = test_support::state(pool.clone(), None, None).await;
    let mut payload = request(&sale, 1.0);
    let first = service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    sqlx::query("UPDATE branch SET is_active=false WHERE id=$1")
        .bind(sale.destination)
        .execute(&pool)
        .await
        .unwrap();
    let replay = service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(payload.clone()).unwrap(),
        "staff",
    )
    .await
    .unwrap();
    assert_eq!(first.id, replay.id);
    payload["lines"][0]["restockLocationId"] = json!(sale.origin);
    assert!(matches!(
        service::create_return(
            &state,
            sale.invoice,
            serde_json::from_value(payload).unwrap(),
            "staff"
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 1.0);
}

#[sqlx::test]
async fn refund_failure_rolls_back_the_restock_destination_and_stock(pool: PgPool) {
    let sale = sale(&pool).await;
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,30,'cash')",
    )
    .bind(sale.invoice)
    .execute(&pool)
    .await
    .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut payload = request(&sale, 1.0);
    payload["refund"] = json!({"timing":"now","payments":[{"amount":9,"paymentType":"cash"}]});
    assert!(service::create_return(
        &state,
        sale.invoice,
        serde_json::from_value(payload).unwrap(),
        "staff"
    )
    .await
    .is_err());
    let after = service::context(&state, sale.invoice).await.unwrap();
    assert!(after.returns.is_empty());
    assert!(after.refunds.is_empty());
    assert_eq!(stock(&pool, &sale, sale.origin).await, 7.0);
    assert_eq!(stock(&pool, &sale, sale.destination).await, 0.0);
}
