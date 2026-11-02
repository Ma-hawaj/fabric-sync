//! Regression coverage for invoice amounts surviving deployment/catalog changes.
use super::{document, service, types::CreateInvoiceInput};
use crate::{
    auth::TokenIntrospection, config::Config, error::AppError,
    features::users::zitadel::ZitadelUserDirectory, state::AppState,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

async fn state(pool: &PgPool, rate: &str, urgency: &str) -> AppState {
    state_with_pricing(pool, rate, Some((urgency, "amount")), Some("15")).await
}

async fn state_with_pricing(
    pool: &PgPool,
    rate: &str,
    urgency: Option<(&str, &str)>,
    customer_price: Option<&str>,
) -> AppState {
    let mut config = Config::from_env();
    config.zitadel_project_id = Some("test-project".into());
    config.zitadel_organization_id = Some("test-org".into());
    config.vat_rate = rate.into();
    config.urgent_charge_amount = urgency.map(|(amount, _)| amount.into());
    config.urgent_charge_unit = urgency.map_or("amount", |(_, unit)| unit).into();
    config.customer_material_base_price = customer_price.map(str::to_string);
    config.oauth_issuer_url = "http://127.0.0.1:1".into();
    config.oauth_introspection_url = Some("http://127.0.0.1:1/introspect".into());
    config.zitadel_users_client_id = Some("test".into());
    config.zitadel_users_client_secret = Some("test".into());
    config.invoice_branding.template_dir = None;
    let auth = TokenIntrospection::discover(&config).await.unwrap();
    let users = ZitadelUserDirectory::discover(&config).await.unwrap();
    AppState::new(config, pool.clone(), auth, users)
}

fn input(value: Value) -> CreateInvoiceInput {
    serde_json::from_value(value).unwrap()
}

async fn fixture(pool: &PgPool) -> (Uuid, Value) {
    let branch: Uuid = sqlx::query_scalar(
        "INSERT INTO branch(name,receives_orders,holds_stock) VALUES('Workshop',true,true) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let material: Uuid = sqlx::query_scalar(
        "INSERT INTO materials(name,junior_price,normal_price,large_price) VALUES('Cotton',90,100,150) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO material_stock(material_id,branch_id,quantity) VALUES($1,$2,100)")
        .bind(material)
        .bind(branch)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO design_options(category,slug,label,cost) VALUES('neck','snapshot-neck','Collar',10)")
        .execute(pool)
        .await
        .unwrap();
    (
        material,
        json!({
            "expectedVatRate":0.1,"discountUnit":"amount","targetDate":"2099-01-01",
            "customers":[{
                "newCustomer":{"name":"Snapshot buyer","mobileNo":"33112233"},
                "measurement":{"date":"2026-10-25","type":"body","fit":"medium"},
                "orders":[{"materialId":material,"productionLocationId":branch,
                    "materialAmount":3,"collar":"snapshot-neck","isUrgent":true}]
            }]
        }),
    )
}

async fn stock(pool: &PgPool, material: Uuid) -> f64 {
    sqlx::query_scalar("SELECT SUM(quantity)::float8 FROM material_stock WHERE material_id=$1")
        .bind(material)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[sqlx::test]
async fn customer_fabric_quantity_edits_keep_issued_prices_after_rate_changes(pool: PgPool) {
    let (material, mut payload) = fixture(&pool).await;
    let order = &mut payload["customers"][0]["orders"][0];
    order["materialSource"] = json!("customer");
    order["materialId"] = Value::Null;
    order["customerMaterialDescription"] = json!("Customer linen");
    let original_state = state(&pool, "0.10", "5").await;
    let created = service::create_invoice(&original_state, input(payload.clone()), "staff")
        .await
        .unwrap();
    assert_eq!(created.total_price, 30.0);
    let html = document::render_invoice_document(&original_state, created.id)
        .await
        .unwrap();
    let editing = service::get_invoice_for_edit(&original_state, created.id)
        .await
        .unwrap();
    payload["customers"][0]["newCustomer"] = Value::Null;
    payload["customers"][0]["existingCustomerId"] =
        json!(editing.customers[0].existing_customer_id);
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(editing.customers[0].orders[0].original_order_id);

    let changed_state = state_with_pricing(&pool, "0.15", Some(("9", "amount")), Some("35")).await;
    assert_eq!(
        document::render_invoice_document(&changed_state, created.id)
            .await
            .unwrap(),
        html
    );
    payload["customers"][0]["orders"][0]["materialAmount"] = json!(4.5);
    payload["customers"][0]["orders"][0]["customerMaterialDescription"] = json!("White linen");
    payload["customers"][0]["orders"][0]["price"] = json!(1);
    payload["customers"][0]["orders"][0]["urgentCharge"] = json!(1);
    let updated = service::update_invoice(&changed_state, created.id, input(payload.clone()))
        .await
        .unwrap();
    assert_eq!(updated.total_price, 30.0);
    let editing = service::get_invoice_for_edit(&changed_state, created.id)
        .await
        .unwrap();
    let saved = &editing.customers[0].orders[0];
    assert_eq!(saved.material_amount, 4.5);
    assert_eq!(
        (saved.base_price, saved.price, saved.urgent_charge),
        (15.0, 25.0, 5.0)
    );
    let detail = service::get_invoice(&changed_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (
            detail.totals.total,
            detail.totals.vat_rate,
            detail.totals.vat
        ),
        (30.0, 0.1, 2.73)
    );

    // Adding an order uses current pricing while the existing order stays issued.
    payload["customers"][0]["orders"][0]["originalOrderId"] = json!(saved.original_order_id);
    let mut added = payload["customers"][0]["orders"][0].clone();
    added.as_object_mut().unwrap().remove("originalOrderId");
    payload["customers"][0]["orders"]
        .as_array_mut()
        .unwrap()
        .push(added);
    let updated = service::update_invoice(&changed_state, created.id, input(payload))
        .await
        .unwrap();
    assert_eq!(updated.total_price, 84.0);
    let editing = service::get_invoice_for_edit(&changed_state, created.id)
        .await
        .unwrap();
    let orders = &editing.customers[0].orders;
    assert_eq!(
        (
            orders[0].base_price,
            orders[0].price,
            orders[0].urgent_charge
        ),
        (15.0, 25.0, 5.0)
    );
    assert_eq!(
        (
            orders[1].base_price,
            orders[1].price,
            orders[1].urgent_charge
        ),
        (35.0, 45.0, 9.0)
    );
    assert_eq!(stock(&pool, material).await, 100.0);
}

async fn assert_saved_urgency_survives_rule_changes(
    pool: PgPool,
    original_rule: (&str, &str),
    expected_charge: f64,
) {
    let (material, mut payload) = fixture(&pool).await;
    let original_state = state_with_pricing(&pool, "0.10", Some(original_rule), None).await;
    let created = service::create_invoice(&original_state, input(payload.clone()), "staff")
        .await
        .unwrap();
    let expected_total = 110.0 + expected_charge;
    assert_eq!(created.total_price, expected_total);
    let editing = service::get_invoice_for_edit(&original_state, created.id)
        .await
        .unwrap();
    payload["customers"][0]["newCustomer"] = Value::Null;
    payload["customers"][0]["existingCustomerId"] =
        json!(editing.customers[0].existing_customer_id);
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(editing.customers[0].orders[0].original_order_id);
    sqlx::query(
        "UPDATE materials SET junior_price=180,normal_price=200,large_price=300 WHERE id=$1",
    )
    .bind(material)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE design_options SET cost=20 WHERE slug='snapshot-neck'")
        .execute(&pool)
        .await
        .unwrap();

    // A rate increase, switching units, or removing the rule cannot replace
    // issued charges when the quantity stays in its original price tier.
    for rule in [Some(("9", "amount")), Some(("25", "percent")), None] {
        let html = document::render_invoice_document(&original_state, created.id)
            .await
            .unwrap();
        let changed_state = state_with_pricing(&pool, "0.15", rule, None).await;
        assert_eq!(
            document::render_invoice_document(&changed_state, created.id)
                .await
                .unwrap(),
            html
        );
        payload["customers"][0]["orders"][0]["materialAmount"] = json!(3.5);
        payload["customers"][0]["orders"][0]["moreDetails"] = json!("Soft thread");
        payload["customers"][0]["measurement"]["chest"] = json!(100);
        let updated = service::update_invoice(&changed_state, created.id, input(payload.clone()))
            .await
            .unwrap();
        assert_eq!(updated.total_price, expected_total);
        let editing = service::get_invoice_for_edit(&changed_state, created.id)
            .await
            .unwrap();
        let order = &editing.customers[0].orders[0];
        assert_eq!(
            (order.base_price, order.price, order.urgent_charge),
            (100.0, 110.0, expected_charge)
        );
        assert_eq!(editing.vat_rate, 0.1);
        assert_eq!(stock(&pool, material).await, 96.5);
        payload["customers"][0]["orders"][0]["originalOrderId"] = json!(order.original_order_id);
    }

    // Crossing tiers still requires the current rule and recalculates both
    // garment and percentage urgency using current prices.
    payload["customers"][0]["orders"][0]["materialAmount"] = json!(4.5);
    let unconfigured = state_with_pricing(&pool, "0.15", None, None).await;
    assert!(matches!(
        service::update_invoice(&unconfigured, created.id, input(payload.clone())).await,
        Err(AppError::BadRequest(_))
    ));
    assert_eq!(stock(&pool, material).await, 96.5);
    let changed_state = state_with_pricing(&pool, "0.15", Some(("25", "percent")), None).await;
    let updated = service::update_invoice(&changed_state, created.id, input(payload))
        .await
        .unwrap();
    assert_eq!(updated.total_price, 400.0);
    assert_eq!(stock(&pool, material).await, 95.5);
}

#[sqlx::test]
async fn saved_fixed_urgency_survives_rule_changes(pool: PgPool) {
    assert_saved_urgency_survives_rule_changes(pool, ("5", "amount"), 5.0).await;
}

#[sqlx::test]
async fn saved_percentage_urgency_survives_rule_changes(pool: PgPool) {
    assert_saved_urgency_survives_rule_changes(pool, ("10", "percent"), 11.0).await;
}

#[sqlx::test]
async fn issued_tax_and_unchanged_charges_survive_rate_and_catalog_changes(pool: PgPool) {
    let (material, mut payload) = fixture(&pool).await;
    let original_state = state(&pool, "0.10", "5").await;
    let created = service::create_invoice(&original_state, input(payload.clone()), "staff")
        .await
        .unwrap();
    assert_eq!(created.total_price, 115.0);
    let before = service::get_invoice(&original_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (
            before.totals.vat_rate,
            before.totals.taxable,
            before.totals.vat
        ),
        (0.1, 104.55, 10.45)
    );
    let html = document::render_invoice_document(&original_state, created.id)
        .await
        .unwrap();
    let editing = service::get_invoice_for_edit(&original_state, created.id)
        .await
        .unwrap();
    payload["customers"][0]["newCustomer"] = Value::Null;
    payload["customers"][0]["existingCustomerId"] =
        json!(editing.customers[0].existing_customer_id);
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(editing.customers[0].orders[0].original_order_id);

    sqlx::query(
        "UPDATE materials SET junior_price=180,normal_price=200,large_price=300 WHERE id=$1",
    )
    .bind(material)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE design_options SET cost=20,is_active=false WHERE slug='snapshot-neck'")
        .execute(&pool)
        .await
        .unwrap();
    let changed_state = state(&pool, "0.15", "9").await;
    // Rendering includes the QR: neither its encoded tax amount nor the receipt changes.
    assert_eq!(
        document::render_invoice_document(&changed_state, created.id)
            .await
            .unwrap(),
        html
    );
    payload["customers"][0]["measurement"]["chest"] = json!(100);
    payload["customers"][0]["orders"][0]["moreDetails"] = json!("Please use soft thread");
    // Forged monetary input cannot replace prices preserved from the database.
    payload["customers"][0]["orders"][0]["price"] = json!(1);
    payload["customers"][0]["orders"][0]["urgentCharge"] = json!(1);
    service::update_invoice(&changed_state, created.id, input(payload.clone()))
        .await
        .unwrap();
    let after = service::get_invoice(&changed_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (
            after.totals.total,
            after.totals.taxable,
            after.totals.vat_rate,
            after.totals.vat
        ),
        (115.0, 104.55, 0.1, 10.45)
    );
    assert_eq!(stock(&pool, material).await, 97.0);
    let editing = service::get_invoice_for_edit(&changed_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (
            editing.customers[0].orders[0].base_price,
            editing.customers[0].orders[0].price,
            editing.customers[0].orders[0].urgent_charge
        ),
        (100.0, 110.0, 5.0)
    );
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(editing.customers[0].orders[0].original_order_id);
    // A quantity change reprices the entire line, including its urgency, at current prices.
    sqlx::query("UPDATE design_options SET is_active=true WHERE slug='snapshot-neck'")
        .execute(&pool)
        .await
        .unwrap();
    payload["customers"][0]["orders"][0]["materialAmount"] = json!(4.5);
    service::update_invoice(&changed_state, created.id, input(payload))
        .await
        .unwrap();
    let after = service::get_invoice(&changed_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (
            after.totals.total,
            after.totals.taxable,
            after.totals.vat_rate,
            after.totals.vat
        ),
        (329.0, 299.09, 0.1, 29.91)
    );
    assert_eq!(stock(&pool, material).await, 95.5);
}

#[sqlx::test]
async fn stale_rate_and_invalid_original_references_leave_invoice_and_stock_untouched(
    pool: PgPool,
) {
    let (material, mut payload) = fixture(&pool).await;
    let original_state = state(&pool, "0.10", "5").await;
    let created = service::create_invoice(&original_state, input(payload.clone()), "staff")
        .await
        .unwrap();
    let editing = service::get_invoice_for_edit(&original_state, created.id)
        .await
        .unwrap();
    payload["customers"][0]["newCustomer"] = Value::Null;
    payload["customers"][0]["existingCustomerId"] =
        json!(editing.customers[0].existing_customer_id);
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(editing.customers[0].orders[0].original_order_id);
    let changed_state = state(&pool, "0.15", "9").await;
    assert!(matches!(
        service::create_invoice(&changed_state, input(payload.clone()), "staff").await,
        Err(AppError::Conflict(_))
    ));
    let mut stale = payload.clone();
    stale["expectedVatRate"] = json!(0.15);
    assert!(matches!(
        service::update_invoice(&changed_state, created.id, input(stale)).await,
        Err(AppError::Conflict(_))
    ));
    let mut duplicate = payload.clone();
    let first = duplicate["customers"][0]["orders"][0].clone();
    duplicate["customers"][0]["orders"]
        .as_array_mut()
        .unwrap()
        .push(first);
    assert!(matches!(
        service::update_invoice(&changed_state, created.id, input(duplicate)).await,
        Err(AppError::BadRequest(_))
    ));
    // A genuine line on another invoice cannot be used as this invoice's saved price.
    let mut other = payload.clone();
    other["expectedVatRate"] = json!(0.15);
    other["customers"][0]["orders"][0]
        .as_object_mut()
        .unwrap()
        .remove("originalOrderId");
    let second = service::create_invoice(&changed_state, input(other), "staff")
        .await
        .unwrap();
    let second_edit = service::get_invoice_for_edit(&changed_state, second.id)
        .await
        .unwrap();
    payload["customers"][0]["orders"][0]["originalOrderId"] =
        json!(second_edit.customers[0].orders[0].original_order_id);
    assert!(matches!(
        service::update_invoice(&changed_state, created.id, input(payload)).await,
        Err(AppError::BadRequest(_))
    ));
    assert_eq!(stock(&pool, material).await, 94.0);
    let saved = service::get_invoice(&changed_state, created.id)
        .await
        .unwrap();
    assert_eq!(
        (saved.totals.total, saved.totals.vat_rate, saved.totals.vat),
        (115.0, 0.1, 10.45)
    );
    let new_invoice = service::get_invoice(&changed_state, second.id)
        .await
        .unwrap();
    assert_eq!(
        (
            new_invoice.totals.total,
            new_invoice.totals.vat_rate,
            new_invoice.totals.vat
        ),
        (119.0, 0.15, 15.52)
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM invoices")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}
