use super::{repository, service};
use crate::{error::AppError, test_support};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn stage_id(db: &PgPool) -> Uuid {
    sqlx::query_scalar("SELECT id FROM order_stages WHERE is_active ORDER BY sort_order LIMIT 1")
        .fetch_one(db)
        .await
        .unwrap()
}

async fn record_production(db: &PgPool, order: Uuid, pickup: Uuid) {
    let stage = stage_id(db).await;
    sqlx::query("INSERT INTO order_stage_progress(order_id,stage_id,status,location_id) VALUES($1,$2,'done',$3)")
        .bind(order).bind(stage).bind(pickup).execute(db).await.unwrap();
    sqlx::query("INSERT INTO order_stage_assignments(order_id,stage_id,assignee_id,assignee_name) VALUES($1,$2,'tailor-1','Tailor One')")
        .bind(order).bind(stage).execute(db).await.unwrap();
    sqlx::query("INSERT INTO order_repairs(order_id,reason) VALUES($1,'Adjust sleeve')")
        .bind(order)
        .execute(db)
        .await
        .unwrap();
}

fn edit_payload(
    edit: &super::types::InvoiceEdit,
    order_id: Uuid,
    notes: &str,
) -> serde_json::Value {
    json!({
        "expectedVatRate": 0.1,
        "discountUnit": "amount",
        "branchId": edit.branch_id,
        "collectionMethod": edit.collection_method,
        "customers": [{
            "existingCustomerId": edit.customers[0].existing_customer_id,
            "measurement": {"date": "2026-11-07", "type": "body", "fit": "medium"},
            "orders": [{
                "originalOrderId": order_id,
                "materialSource": "customer",
                "customerMaterialDescription": "Customer cotton",
                "materialAmount": 3,
                "productionLocationId": edit.customers[0].orders[0].production_location_id,
                "moreDetails": notes,
            }]
        }]
    })
}

#[sqlx::test]
async fn creation_and_edit_record_history_events_with_actor_and_diff(db: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&db, 1, false).await;
    let state = test_support::state(db.clone(), None, None).await;

    // The fixture inserts the invoice directly, so seed a creation event the
    // way service::create_invoice would, then make a real edit.
    let edit = service::get_invoice_for_edit(&state, invoice)
        .await
        .unwrap();
    let payload = edit_payload(&edit, orders[0], "Edited notes");
    service::update_invoice(
        &state,
        invoice,
        serde_json::from_value(payload).unwrap(),
        "editor",
    )
    .await
    .unwrap();

    let events = sqlx::query!(
        "SELECT event_type, actor, changes FROM invoice_edit_events WHERE invoice_id=$1 ORDER BY occurred_at",
        invoice,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    let edited = events.iter().find(|e| e.event_type == "edited").unwrap();
    assert_eq!(edited.actor.as_deref(), Some("editor"));
    let changes: Vec<super::history::FieldChange> =
        serde_json::from_value(edited.changes.clone()).unwrap();
    assert!(changes.iter().any(|c| c.path.ends_with(".moreDetails")));

    let history = service::invoice_history(&state, invoice).await.unwrap();
    assert!(history
        .iter()
        .any(|e| matches!(e, super::history::InvoiceHistoryEntry::Created { .. })));
    assert!(history.iter().any(|e| matches!(e, super::history::InvoiceHistoryEntry::Edited { actor: Some(a), .. } if a == "editor")));
}

#[sqlx::test]
async fn service_create_writes_a_created_event(db: PgPool) {
    crate::seed::run_reference_data(&db).await.unwrap();
    let production: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,produces_orders) VALUES('Workshop',true) RETURNING id",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let state = test_support::state(db.clone(), None, None).await;
    let payload = json!({
        "expectedVatRate": 0.1, "discountUnit": "amount",
        "customers": [{
            "newCustomer": {"name": "Buyer", "mobileNo": "33112233"},
            "measurement": {"date": "2026-11-07", "type": "body", "fit": "medium"},
            "orders": [{"materialSource": "customer", "customerMaterialDescription": "Cloth", "materialAmount": 3, "productionLocationId": production}]
        }]
    });
    let created =
        service::create_invoice(&state, serde_json::from_value(payload).unwrap(), "creator")
            .await
            .unwrap();
    let event = sqlx::query!(
        "SELECT event_type, actor, total_after::float8 AS \"total_after?\" FROM invoice_edit_events WHERE invoice_id=$1",
        created.id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(event.event_type, "created");
    assert_eq!(event.actor.as_deref(), Some("creator"));
    assert_eq!(event.total_after, Some(created.total_price));
}

#[sqlx::test]
async fn production_records_and_readiness_are_carried_onto_rebuilt_orders(db: PgPool) {
    let (invoice, orders, production, pickup) = test_support::invoice(&db, 1, false).await;
    record_production(&db, orders[0], pickup).await;
    let order_number: i64 = sqlx::query_scalar("SELECT order_number FROM orders WHERE id=$1")
        .bind(orders[0])
        .fetch_one(&db)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status='ready', ready_at=now(), ready_by='staff', ready_location_id=$2, readiness_version=1 WHERE id=$1")
        .bind(orders[0]).bind(pickup).execute(&db).await.unwrap();

    let state = test_support::state(db.clone(), None, None).await;
    let edit = service::get_invoice_for_edit(&state, invoice)
        .await
        .unwrap();
    let payload = edit_payload(&edit, orders[0], "Carried notes");
    service::update_invoice(
        &state,
        invoice,
        serde_json::from_value(payload).unwrap(),
        "staff",
    )
    .await
    .unwrap();

    // The rebuilt order is a new row, but keeps the garment's identity and work.
    let edit = service::get_invoice_for_edit(&state, invoice)
        .await
        .unwrap();
    let new_id = edit.customers[0].orders[0].original_order_id;
    assert_ne!(new_id, orders[0]);
    assert_eq!(
        edit.customers[0].orders[0].more_details.as_deref(),
        Some("Carried notes")
    );

    let carried_number: i64 = sqlx::query_scalar("SELECT order_number FROM orders WHERE id=$1")
        .bind(new_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(carried_number, order_number);
    let (status, ready_by): (String, Option<String>) =
        sqlx::query_as("SELECT status, ready_by FROM orders WHERE id=$1")
            .bind(new_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(status, "ready");
    assert_eq!(ready_by.as_deref(), Some("staff"));

    let progress: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_stage_progress WHERE order_id=$1")
            .bind(new_id)
            .fetch_one(&db)
            .await
            .unwrap();
    let assignments: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_stage_assignments WHERE order_id=$1")
            .bind(new_id)
            .fetch_one(&db)
            .await
            .unwrap();
    let repairs: i64 = sqlx::query_scalar("SELECT count(*) FROM order_repairs WHERE order_id=$1")
        .bind(new_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(progress, 1);
    assert_eq!(assignments, 1);
    assert_eq!(repairs, 1);
    // Nothing is left pointing at the torn-down row.
    let orphaned: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_stage_progress WHERE order_id=$1")
            .bind(orders[0])
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(orphaned, 0);
    let _ = production;
}

#[sqlx::test]
async fn removing_a_produced_garment_is_refused(db: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&db, 2, false).await;
    record_production(&db, orders[0], pickup).await;
    let state = test_support::state(db.clone(), None, None).await;
    let edit = service::get_invoice_for_edit(&state, invoice)
        .await
        .unwrap();
    // Keep only the second garment, dropping the produced one.
    let payload = json!({
        "expectedVatRate": 0.1, "discountUnit": "amount",
        "branchId": edit.branch_id, "collectionMethod": edit.collection_method,
        "customers": [{
            "existingCustomerId": edit.customers[0].existing_customer_id,
            "measurement": {"date": "2026-11-07", "type": "body", "fit": "medium"},
            "orders": [{
                "originalOrderId": orders[1],
                "materialSource": "customer", "customerMaterialDescription": "Customer cotton",
                "materialAmount": 3,
                "productionLocationId": edit.customers[0].orders[1].production_location_id,
            }]
        }]
    });
    let result = service::update_invoice(
        &state,
        invoice,
        serde_json::from_value(payload).unwrap(),
        "staff",
    )
    .await;
    assert!(
        matches!(result, Err(AppError::BadRequest(message)) if message.contains("production records"))
    );
    // Both garments and the production record survive the refused edit.
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM orders WHERE invoice_id=$1")
        .bind(invoice)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 2);
    let progress: i64 =
        sqlx::query_scalar("SELECT count(*) FROM order_stage_progress WHERE order_id=$1")
            .bind(orders[0])
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(progress, 1);
}

#[sqlx::test]
async fn history_merges_payment_events(db: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&db, 1, false).await;
    let state = test_support::state(db.clone(), None, None).await;
    let mut tx = db.begin().await.unwrap();
    repository::insert_payment(&mut tx, invoice, None, 40.0, Some("cash"), "till")
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let history = service::invoice_history(&state, invoice).await.unwrap();
    assert!(history.iter().any(|e| matches!(
        e,
        super::history::InvoiceHistoryEntry::Payment { amount, actor: Some(a), .. }
            if *amount == 40.0 && a == "till"
    )));
    let _ = orders;
}
