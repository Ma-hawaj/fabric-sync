use super::{service, types::CreateInvoiceInput};
use crate::{error::AppError, test_support};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn quantity(db: &PgPool, material: Uuid, branch: Uuid) -> f64 {
    sqlx::query_scalar(
        "SELECT quantity::float8 FROM material_stock WHERE material_id=$1 AND branch_id=$2",
    )
    .bind(material)
    .bind(branch)
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test]
async fn warehouse_stock_and_production_only_workshop_stay_independent_through_edits(db: PgPool) {
    let warehouse: Uuid = sqlx::query_scalar("INSERT INTO branch(name,receives_orders,holds_stock,produces_orders) VALUES('Warehouse',false,true,false) RETURNING id").fetch_one(&db).await.unwrap();
    let workshop: Uuid = sqlx::query_scalar("INSERT INTO branch(name,receives_orders,holds_stock,produces_orders) VALUES('Workshop',false,false,true) RETURNING id").fetch_one(&db).await.unwrap();
    let other_workshop: Uuid = sqlx::query_scalar("INSERT INTO branch(name,receives_orders,holds_stock,produces_orders) VALUES('Other workshop',false,false,true) RETURNING id").fetch_one(&db).await.unwrap();
    let material: Uuid = sqlx::query_scalar("INSERT INTO materials(name,junior_price,normal_price,large_price) VALUES('Cotton',10,20,30) RETURNING id").fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,10)")
        .bind(material)
        .bind(warehouse)
        .execute(&db)
        .await
        .unwrap();
    let mut payload = json!({"expectedVatRate":0.1,"discountUnit":"amount","customers":[{
        "newCustomer":{"name":"Buyer","mobileNo":"33112233"},
        "measurement":{"date":"2026-11-06","type":"body","fit":"medium"},
        "orders":[{"materialId":material,"materialLocationId":warehouse,"productionLocationId":workshop,"materialAmount":3}]
    }]});
    let state = test_support::state(db.clone(), None, None).await;
    let mut invalid = payload.clone();
    invalid["customers"][0]["orders"][0]["productionLocationId"] = json!(warehouse);
    assert!(matches!(
        service::create_invoice(&state, serde_json::from_value(invalid).unwrap(), "staff").await,
        Err(AppError::BadRequest(_))
    ));
    assert_eq!(quantity(&db, material, warehouse).await, 10.0);
    sqlx::query("UPDATE branch SET is_active=false WHERE id=$1")
        .bind(warehouse)
        .execute(&db)
        .await
        .unwrap();
    assert!(matches!(
        service::create_invoice(
            &state,
            serde_json::from_value(payload.clone()).unwrap(),
            "staff"
        )
        .await,
        Err(AppError::BadRequest(_))
    ));
    sqlx::query("UPDATE branch SET is_active=true WHERE id=$1")
        .bind(warehouse)
        .execute(&db)
        .await
        .unwrap();
    let input: CreateInvoiceInput = serde_json::from_value(payload.clone()).unwrap();
    let created = service::create_invoice(&state, input, "staff")
        .await
        .unwrap();
    assert_eq!(quantity(&db, material, warehouse).await, 7.0);
    let edit = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    let line = &edit.customers[0].orders[0];
    assert_eq!(line.material_location_id, Some(warehouse));
    assert_eq!(line.production_location_id, Some(workshop));
    assert_eq!(line.stock_quantity, Some(7.0));
    payload["customers"][0]["newCustomer"] = serde_json::Value::Null;
    payload["customers"][0]["existingCustomerId"] = json!(edit.customers[0].existing_customer_id);
    payload["customers"][0]["orders"][0]["originalOrderId"] = json!(line.original_order_id);
    payload["customers"][0]["orders"][0]["productionLocationId"] = json!(other_workshop);
    sqlx::query("UPDATE materials SET normal_price=99 WHERE id=$1")
        .bind(material)
        .execute(&db)
        .await
        .unwrap();
    let saved = service::update_invoice(
        &state,
        created.id,
        serde_json::from_value(payload.clone()).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(saved.total_price, created.total_price);
    assert_eq!(quantity(&db, material, warehouse).await, 7.0);
    let edit = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    let line = &edit.customers[0].orders[0];
    assert_eq!(line.production_location_id, Some(other_workshop));
    assert_eq!(line.material_location_id, Some(warehouse));
    let stock_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM material_stock WHERE branch_id IN ($1,$2)")
            .bind(workshop)
            .bind(other_workshop)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(stock_rows, 0);
    let other_warehouse: Uuid = sqlx::query_scalar("INSERT INTO branch(name,receives_orders,holds_stock,produces_orders) VALUES('Other warehouse',false,true,false) RETURNING id").fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,5)")
        .bind(material)
        .bind(other_warehouse)
        .execute(&db)
        .await
        .unwrap();
    payload["customers"][0]["orders"][0]["originalOrderId"] = json!(line.original_order_id);
    payload["customers"][0]["orders"][0]["materialLocationId"] = json!(other_warehouse);
    service::update_invoice(&state, created.id, serde_json::from_value(payload).unwrap())
        .await
        .unwrap();
    assert_eq!(quantity(&db, material, warehouse).await, 10.0);
    assert_eq!(quantity(&db, material, other_warehouse).await, 2.0);
}
