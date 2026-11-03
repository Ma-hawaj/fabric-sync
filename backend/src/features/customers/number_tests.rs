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
    assert_eq!(saved.readable_id, "C-6216-001");
    assert_eq!(
        serde_json::to_value(saved).unwrap()["readableId"],
        "C-6216-001"
    );
    let history = super::repository::get_customer(&state, first)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(history.measurements[0].readable_id, "C-6216-002");
    assert_eq!(history.measurements[1].readable_id, "C-6216-001");

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
        "C-6216-001"
    );
    let large: String = sqlx::query_scalar("SELECT readable_measurement_id(6216,1000)")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(large, "C-6216-1000");
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
async fn saved_measurement_numbers_cannot_change_or_be_reused(pool: PgPool) {
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
    sqlx::query("DELETE FROM measurements WHERE id=$1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(measurement(&pool, owner).await.1, 2);
}
