use sqlx::PgPool;
use uuid::Uuid;

use super::{repository, service, types::Customer};
use crate::{error::AppError, state::AppState};

async fn customer(state: &AppState, name: &str, enabled: bool) -> Customer {
    service::create_customer(
        state,
        serde_json::from_value(serde_json::json!({
            "name": name, "mobileNo": "+97333112233", "address": format!("Address for {name}"),
            "whatsappNotificationsEnabled": enabled,
            "measurement": {"date": "2026-11-07", "type": "body", "fit": "regular", "chest": 42.5}
        }))
        .unwrap(),
    )
    .await
    .unwrap()
}

async fn invoice(pool: &PgPool, customer: Uuid, measurement: Uuid) -> Uuid {
    let id: Uuid = sqlx::query_scalar("INSERT INTO invoices(customer_id,total_price,vat_rate,taxable_amount,vat_amount) VALUES($1,11,0.1,10,1) RETURNING id")
        .bind(customer).fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO orders(invoice_id,measurement_id,material_source,material_amount,price) VALUES($1,$2,'unknown',1,11)")
        .bind(id).bind(measurement).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,5,'cash')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

#[sqlx::test]
async fn merge_keeps_all_history_labels_contacts_and_opt_outs(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let source = customer(&state, "Ali Ahmad", false).await;
    let target = customer(&state, "Ali Ahmed", true).await;
    let invoice_id = invoice(&pool, source.id, source.measurements[0].id).await;
    let card: Uuid = sqlx::query_scalar("INSERT INTO gift_cards(code,initial_amount,balance,customer_id) VALUES('MERGE',20,15,$1) RETURNING id")
        .bind(source.id).fetch_one(&pool).await.unwrap();
    let before: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id,readable_id FROM measurements ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    let merged = service::merge_customer(&state, source.id, target.id, "staff-1")
        .await
        .unwrap();
    assert_eq!(merged.id, target.id);
    assert_eq!(merged.customer_number, target.customer_number);
    assert_eq!(merged.name, target.name);
    assert_eq!(merged.address, target.address);
    assert!(!merged.whatsapp_notifications_enabled);
    assert_eq!(merged.measurements.len(), 2);
    assert_eq!(merged.invoices.len(), 1);
    assert_eq!(merged.invoices[0].id, invoice_id);
    assert_eq!(merged.invoices[0].balance_due, 6.0);
    let after: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id,readable_id FROM measurements ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(before, after);
    for snapshot in &merged.measurements {
        assert_eq!(snapshot.customer_id, target.id);
        assert_eq!(snapshot.chest, Some(42.5));
    }
    let linked: Uuid = sqlx::query_scalar("SELECT customer_id FROM gift_cards WHERE id=$1")
        .bind(card)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(linked, target.id);
    let actor: String =
        sqlx::query_scalar("SELECT merged_by FROM customer_aliases WHERE source_customer_id=$1")
            .bind(source.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(actor, "staff-1");
    assert_eq!(
        service::get_customer(&state, source.id).await.unwrap().id,
        target.id
    );
    assert_eq!(
        repository::get_measurement(&state, source.measurements[0].id)
            .await
            .unwrap()
            .unwrap()
            .readable_id,
        source.measurements[0].readable_id
    );
    let next: String = sqlx::query_scalar(
        "INSERT INTO measurements(customer_id) VALUES($1) RETURNING readable_id",
    )
    .bind(target.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(next, format!("C-{}-002", target.customer_number));
    service::merge_customer(&state, source.id, target.id, "retry")
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM customers")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[sqlx::test]
async fn chained_merges_resolve_old_names_and_do_not_recreate_customers(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let source = customer(&state, "Ali Ahmad", true).await;
    let middle = customer(&state, "Ali Ahmed", true).await;
    let target = customer(&state, "Ali", true).await;
    service::merge_customer(&state, source.id, middle.id, "staff")
        .await
        .unwrap();
    service::merge_customer(&state, middle.id, target.id, "staff")
        .await
        .unwrap();
    let existing = service::create_customer(
        &state,
        serde_json::from_value(serde_json::json!({
            "name": "  ALI   AHMAD  ", "mobileNo": "33112233", "whatsappNotificationsEnabled": false
        }))
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(existing.id, target.id);
    assert!(!existing.whatsapp_notifications_enabled);
    assert_eq!(existing.measurements.len(), 3);
    assert_eq!(
        service::get_customer(&state, source.id).await.unwrap().id,
        target.id
    );
    let destinations: Vec<Uuid> =
        sqlx::query_scalar("SELECT target_customer_id FROM customer_aliases")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(destinations, vec![target.id, target.id]);
}

#[sqlx::test]
async fn self_missing_and_stale_merges_do_not_remove_other_people(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let first = customer(&state, "First", true).await;
    let second = customer(&state, "Second", true).await;
    let third = customer(&state, "Third", true).await;
    assert!(matches!(
        service::merge_customer(&state, first.id, first.id, "staff").await,
        Err(AppError::BadRequest(_))
    ));
    assert!(matches!(
        service::merge_customer(&state, first.id, Uuid::new_v4(), "staff").await,
        Err(AppError::NotFound(_))
    ));
    service::merge_customer(&state, first.id, second.id, "staff")
        .await
        .unwrap();
    assert!(matches!(
        service::merge_customer(&state, first.id, third.id, "staff").await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        service::get_customer(&state, third.id)
            .await
            .unwrap()
            .measurements
            .len(),
        1
    );
}

#[sqlx::test]
async fn failed_merge_rolls_back_aliases_and_measurement_ownership(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let source = customer(&state, "Source", true).await;
    let target = customer(&state, "Target", true).await;
    sqlx::query(
        "INSERT INTO gift_cards(code,initial_amount,balance,customer_id) VALUES('BLOCK',20,20,$1)",
    )
    .bind(source.id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql("CREATE FUNCTION block_card_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'blocked'; END $$; CREATE TRIGGER block_card_move BEFORE UPDATE ON gift_cards FOR EACH ROW EXECUTE FUNCTION block_card_move();")
        .execute(&pool).await.unwrap();
    assert!(
        service::merge_customer(&state, source.id, target.id, "staff")
            .await
            .is_err()
    );
    assert_eq!(
        service::get_customer(&state, source.id)
            .await
            .unwrap()
            .measurements
            .len(),
        1
    );
    assert_eq!(
        service::get_customer(&state, target.id)
            .await
            .unwrap()
            .measurements
            .len(),
        1
    );
    let aliases: i64 = sqlx::query_scalar("SELECT count(*) FROM customer_aliases")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(aliases, 0);
}

#[sqlx::test]
async fn concurrent_retries_only_merge_once(pool: PgPool) {
    let state = crate::test_support::state(pool.clone(), None, None).await;
    let source = customer(&state, "Source", true).await;
    let target = customer(&state, "Target", true).await;
    let (first, second) = tokio::join!(
        service::merge_customer(&state, source.id, target.id, "first"),
        service::merge_customer(&state, source.id, target.id, "second"),
    );
    assert_eq!(first.unwrap().measurements.len(), 2);
    assert_eq!(second.unwrap().measurements.len(), 2);
}
