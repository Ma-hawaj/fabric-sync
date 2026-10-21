//! Opt-in PostgreSQL regression test. Creates its own schema and never touches
//! application tables in the database's default schema.
use super::{document, service, types::CreateInvoiceInput};
use crate::{
    auth::TokenIntrospection, config::Config, features::users::zitadel::ZitadelUserDirectory,
    state::AppState,
};
use serde_json::json;
use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

fn sale(material: Uuid, branch: Uuid, quantity: f64) -> CreateInvoiceInput {
    serde_json::from_value(json!({
        "discountUnit": "amount",
        "materials": [{ "materialId": material, "branchId": branch, "quantity": quantity, "unitPrice": 11.0 }],
    })).unwrap()
}

async fn stock(pool: &PgPool, material: Uuid, branch: Uuid) -> f64 {
    sqlx::query_scalar(
        "SELECT quantity::float8 FROM material_stock WHERE material_id = $1 AND branch_id = $2",
    )
    .bind(material)
    .bind(branch)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to PostgreSQL 18+"]
async fn material_sales_database() {
    let url = std::env::var("TEST_DATABASE_URL").expect("set TEST_DATABASE_URL");
    let admin = PgPool::connect(&url).await.unwrap();
    let schema = format!("material_sale_test_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .unwrap();
    let search_path = schema.clone();
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |connection, _| {
            let schema = search_path.clone();
            Box::pin(async move {
                sqlx::query("SELECT set_config('search_path', $1, false)")
                    .bind(schema)
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();
    let mut config = Config::from_env();
    config.oauth_introspection_url = Some("http://localhost/unused".into());
    config.zitadel_users_client_id = Some("unused".into());
    config.zitadel_users_client_secret = Some("unused".into());
    config.invoice_branding.template_dir = None;
    let tokens = TokenIntrospection::discover(&config).await.unwrap();
    let users = ZitadelUserDirectory::discover(&config).await.unwrap();
    let state = AppState::new(config, pool.clone(), tokens, users);
    let branch: Uuid = sqlx::query_scalar("INSERT INTO branch (name, receives_orders, holds_stock) VALUES ('Stock', true, true) RETURNING id").fetch_one(&pool).await.unwrap();
    let other: Uuid = sqlx::query_scalar("INSERT INTO branch (name, receives_orders, holds_stock) VALUES ('Other', false, true) RETURNING id").fetch_one(&pool).await.unwrap();
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO materials (name, unit) VALUES ('Linen', 'meters') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    for location in [branch, other] {
        sqlx::query(
            "INSERT INTO material_stock (material_id, branch_id, quantity) VALUES ($1, $2, 10)",
        )
        .bind(material)
        .bind(location)
        .execute(&pool)
        .await
        .unwrap();
    }

    let created = service::create_invoice(&state, sale(material, branch, 2.5))
        .await
        .unwrap();
    assert_eq!(created.total_price, 27.5);
    assert_eq!(stock(&pool, material, branch).await, 7.5);
    for table in ["orders", "measurements"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    let detail = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(detail.order_count, 0);
    assert!(detail.received);
    assert!(detail.lines[0].order_id.is_none());
    assert_eq!(detail.lines[0].unit.as_deref(), Some("meters"));
    assert_eq!(detail.totals.vat, 2.5);
    let edit = service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap();
    assert_eq!(edit.materials[0].material_id, Some(material));
    assert_eq!(edit.materials[0].quantity, 2.5);
    let html = document::render_invoice_document(&state, created.id)
        .await
        .unwrap();
    assert!(html.contains("Linen"));
    assert!(html.contains("meters"));
    let page = service::list_invoices(&state, &crate::list::ListParams::default())
        .await
        .unwrap();
    assert!(page
        .data
        .iter()
        .any(|row| row.id == created.id && row.materials == vec!["Linen"]));

    let filtered = crate::list::ListParams {
        filters: vec![serde_json::from_value(json!({
            "id": "materials", "variant": "multiSelect", "operator": "inArray", "value": ["Linen"]
        }))
        .unwrap()],
        ..Default::default()
    };
    assert_eq!(
        service::list_invoices(&state, &filtered)
            .await
            .unwrap()
            .total,
        1
    );

    // Catalog changes must not rewrite the saved receipt's description/unit.
    sqlx::query("UPDATE materials SET name = 'Renamed', unit = 'yards' WHERE id = $1")
        .bind(material)
        .execute(&pool)
        .await
        .unwrap();
    let detail = service::get_invoice(&state, created.id).await.unwrap();
    assert_eq!(detail.lines[0].description, "Linen");
    assert_eq!(detail.lines[0].unit.as_deref(), Some("meters"));

    // Failed create and failed edit must return every earlier decrement.
    let mut duplicate = sale(material, branch, 4.0);
    duplicate.materials.push(duplicate.materials[0].clone());
    assert!(service::create_invoice(&state, duplicate).await.is_err());
    assert_eq!(stock(&pool, material, branch).await, 7.5);
    assert!(
        service::update_invoice(&state, created.id, sale(material, branch, 11.0))
            .await
            .is_err()
    );
    assert_eq!(stock(&pool, material, branch).await, 7.5);
    assert_eq!(
        service::get_invoice(&state, created.id)
            .await
            .unwrap()
            .totals
            .total,
        27.5
    );

    service::update_invoice(&state, created.id, sale(material, other, 3.0))
        .await
        .unwrap();
    assert_eq!(stock(&pool, material, branch).await, 10.0);
    assert_eq!(stock(&pool, material, other).await, 7.0);

    sqlx::query("UPDATE branch SET is_active = false WHERE id = $1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();
    assert!(service::create_invoice(&state, sale(material, branch, 1.0))
        .await
        .is_err());
    assert_eq!(stock(&pool, material, branch).await, 10.0);
    sqlx::query("UPDATE branch SET is_active = true WHERE id = $1")
        .bind(branch)
        .execute(&pool)
        .await
        .unwrap();

    // Concurrent invoices cannot sell the same stock twice.
    let (a, b) = tokio::join!(
        service::create_invoice(&state, sale(material, branch, 6.0)),
        service::create_invoice(&state, sale(material, branch, 6.0))
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(stock(&pool, material, branch).await, 4.0);

    // A tailoring order and a direct sale compete for the same stock, and a
    // failed combined sale rolls back its new customer and measurements too.
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers (name, mobile_no) VALUES ('Buyer', '123') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut mixed = sale(material, branch, 3.0);
    mixed.customers = serde_json::from_value(json!([{
        "existingCustomerId": customer,
        "measurement": { "date": "2026-10-21", "type": "body", "fit": "medium" },
        "orders": [{ "materialId": material, "materialAmount": 2.0, "productionLocationId": branch, "price": 22.0 }]
    }])).unwrap();
    assert!(service::create_invoice(&state, mixed.clone())
        .await
        .is_err());
    assert_eq!(stock(&pool, material, branch).await, 4.0);
    mixed.materials[0].quantity = 2.0;
    let mixed_created = service::create_invoice(&state, mixed).await.unwrap();
    assert_eq!(mixed_created.total_price, 44.0);
    assert_eq!(stock(&pool, material, branch).await, 0.0);
    assert_eq!(
        service::get_invoice(&state, mixed_created.id)
            .await
            .unwrap()
            .order_count,
        1
    );

    // Removing every material line returns the stock; the invoice still needs
    // a line of another kind, here a gift card.
    let replacement: CreateInvoiceInput = serde_json::from_value(json!({ "discountUnit": "amount", "giftCards": [{ "code": "MATERIAL-TEST", "amount": 10 }] })).unwrap();
    service::update_invoice(&state, created.id, replacement)
        .await
        .unwrap();
    assert_eq!(stock(&pool, material, other).await, 10.0);
    assert!(service::get_invoice_for_edit(&state, created.id)
        .await
        .unwrap()
        .materials
        .is_empty());

    // Persist the exact rounded line total used by pricing; independently
    // rounding the float multiplication in SQL can yield a different cent.
    let mut rounding_sale = sale(material, other, 1.15);
    rounding_sale.materials[0].unit_price = 0.1;
    let rounding_created = service::create_invoice(&state, rounding_sale)
        .await
        .unwrap();
    let rounding_detail = service::get_invoice(&state, rounding_created.id)
        .await
        .unwrap();
    assert_eq!(
        rounding_created.total_price,
        rounding_detail.lines[0].line_total
    );
    assert_eq!(
        rounding_created.total_price,
        rounding_detail.totals.subtotal
    );

    pool.close().await;
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
