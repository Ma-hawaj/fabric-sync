use sqlx::PgPool;
use uuid::Uuid;

async fn customer(pool: &PgPool, name: &str, number: i64) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no,customer_number) OVERRIDING SYSTEM VALUE VALUES($1,'33112233',$2) RETURNING id",
    )
    .bind(name)
    .bind(number)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn measurement(pool: &PgPool, customer: Uuid) -> (Uuid, i64) {
    sqlx::query_as(
        "INSERT INTO measurements(customer_id) VALUES($1) RETURNING id,measurement_number",
    )
    .bind(customer)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test]
async fn measurements_have_independent_per_customer_ids_in_both_api_projections(pool: PgPool) {
    let first = customer(&pool, "First", 6216).await;
    let second = customer(&pool, "Second", 9179).await;
    let (original, number) = measurement(&pool, first).await;
    assert_eq!(number, 1);
    assert_eq!(measurement(&pool, second).await.1, 1);
    assert_eq!(measurement(&pool, first).await.1, 2);

    let state = crate::test_support::state(pool.clone(), None, None).await;
    let saved = super::repository::get_measurement(&state, original)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.readable_id, "CSTMR-6216-001");
    assert_eq!(
        serde_json::to_value(saved).unwrap()["readableId"],
        "CSTMR-6216-001"
    );
    let history = super::repository::get_customer(&state, first)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(history.measurements[0].readable_id, "CSTMR-6216-002");
    assert_eq!(history.measurements[1].readable_id, "CSTMR-6216-001");

    // Editing a customer's contact details does not change measurement IDs.
    sqlx::query("UPDATE customers SET name='Renamed' WHERE id=$1")
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        super::repository::get_measurement(&state, original)
            .await
            .unwrap()
            .unwrap()
            .readable_id,
        "CSTMR-6216-001"
    );
    let large: String = sqlx::query_scalar("SELECT readable_measurement_id(6216,1000)")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(large, "CSTMR-6216-1000");
}

#[sqlx::test]
async fn concurrent_measurement_inserts_allocate_distinct_numbers(pool: PgPool) {
    let owner = customer(&pool, "Concurrent", 6216).await;
    let (first, second) = tokio::join!(measurement(&pool, owner), measurement(&pool, owner));
    let mut numbers = [first.1, second.1];
    numbers.sort();
    assert_eq!(numbers, [1, 2]);
}

#[sqlx::test]
async fn saved_measurement_identities_cannot_change(pool: PgPool) {
    let owner = customer(&pool, "Permanent", 6216).await;
    let other = customer(&pool, "Other", 9179).await;
    let (id, _) = measurement(&pool, owner).await;
    for query in [
        sqlx::query("UPDATE measurements SET measurement_number=2 WHERE id=$1").bind(id),
        sqlx::query("UPDATE measurements SET customer_id=$2 WHERE id=$1")
            .bind(id)
            .bind(other),
        sqlx::query("INSERT INTO measurements(customer_id,measurement_number) VALUES($1,42)")
            .bind(owner),
    ] {
        let error = query.execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514")
        );
    }
    assert_eq!(measurement(&pool, owner).await.1, 2);
}

#[sqlx::test]
async fn all_measurement_history_is_retained_after_delete_and_truncate_attempts(pool: PgPool) {
    let (_, orders, _, _) = crate::test_support::invoice(&pool, 1, false).await;
    let owner: Uuid = sqlx::query_scalar(
        "SELECT m.customer_id FROM measurements m JOIN orders o ON o.measurement_id=m.id WHERE o.id=$1",
    )
    .bind(orders[0])
    .fetch_one(&pool)
    .await
    .unwrap();
    let (fixed, _) = measurement(&pool, owner).await;
    let other = customer(&pool, "Unreferenced history", 9179).await;
    let (unreferenced, _) = measurement(&pool, other).await;
    let repair: Uuid = sqlx::query_scalar(
        "INSERT INTO order_repairs(order_id,reason,fixed_measurement_id) VALUES($1,'Preserve correction',$2) RETURNING id",
    )
    .bind(orders[0])
    .bind(fixed)
    .fetch_one(&pool)
    .await
    .unwrap();
    let originals: Vec<(Uuid, Uuid, i64)> =
        sqlx::query_as("SELECT id,customer_id,measurement_number FROM measurements ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();

    for query in [
        sqlx::query("DELETE FROM measurements WHERE id=$1").bind(unreferenced),
        sqlx::query("DELETE FROM measurements WHERE id=$1").bind(fixed),
        sqlx::query("DELETE FROM measurements WHERE customer_id=$1").bind(owner),
        sqlx::query("DELETE FROM measurements"),
        sqlx::query("TRUNCATE measurements CASCADE"),
        sqlx::query("TRUNCATE customers CASCADE"),
    ] {
        let error = query.execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514")
        );
        let retained: Vec<(Uuid, Uuid, i64)> = sqlx::query_as(
            "SELECT id,customer_id,measurement_number FROM measurements ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(retained, originals);
        let saved_fix: Option<Uuid> =
            sqlx::query_scalar("SELECT fixed_measurement_id FROM order_repairs WHERE id=$1")
                .bind(repair)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(saved_fix, Some(fixed));
    }

    let error = sqlx::query("DELETE FROM customers WHERE id=$1")
        .bind(other)
        .execute(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("23503")
    );
    assert_eq!(measurement(&pool, other).await.1, 2);
    assert_eq!(measurement(&pool, owner).await.1, 3);
}
