use crate::{
    auth::TokenIntrospection, config::Config, features::users::zitadel::ZitadelUserDirectory,
    state::AppState,
};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn state(db: PgPool, renderer: Option<String>, provider: Option<String>) -> AppState {
    let mut config = Config::from_env();
    config.urgent_charge_amount = Some("5".into());
    config.urgent_charge_unit = "amount".into();
    config.customer_material_base_price = Some("15".into());
    config.oauth_issuer_url = "http://127.0.0.1:1".into();
    config.oauth_introspection_url = Some("http://127.0.0.1:1/introspect".into());
    config.zitadel_users_client_id = Some("test".into());
    config.zitadel_users_client_secret = Some("test".into());
    config.notifications.enabled = true;
    config.notifications.renderer_url = renderer;
    config.notifications.phone_number_id = Some("test-phone".into());
    config.notifications.access_token = Some("test-token".into());
    config.notifications.test_graph_url = provider;
    config.notifications.app_secret = Some("test-webhook-secret".into());
    config.notifications.verification_token = Some("test-verify-token".into());
    let auth = TokenIntrospection::discover(&config).await.unwrap();
    let users = ZitadelUserDirectory::discover(&config).await.unwrap();
    AppState::new(config, db, auth, users)
}

pub async fn invoice(
    db: &PgPool,
    count: usize,
    separate_pickup: bool,
) -> (Uuid, Vec<Uuid>, Uuid, Uuid) {
    crate::seed::run_reference_data(db).await.unwrap();
    let production: Uuid = sqlx::query_scalar("INSERT INTO branch(name) VALUES($1) RETURNING id")
        .bind(format!("Production {}", Uuid::new_v4()))
        .fetch_one(db)
        .await
        .unwrap();
    let pickup = if separate_pickup {
        sqlx::query_scalar("INSERT INTO branch(name) VALUES($1) RETURNING id")
            .bind(format!("Pickup {}", Uuid::new_v4()))
            .fetch_one(db)
            .await
            .unwrap()
    } else {
        production
    };
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('First Customer','33112233') RETURNING id",
    )
    .fetch_one(db)
    .await
    .unwrap();
    let measurement: Uuid =
        sqlx::query_scalar("INSERT INTO measurements(customer_id) VALUES($1) RETURNING id")
            .bind(customer)
            .fetch_one(db)
            .await
            .unwrap();
    let invoice: Uuid = sqlx::query_scalar(
        "INSERT INTO invoices(branch_id,total_price) VALUES($1,$2::float8) RETURNING id",
    )
    .bind(pickup)
    .bind(count as f64 * 100.0)
    .fetch_one(db)
    .await
    .unwrap();
    let mut orders = Vec::new();
    for _ in 0..count {
        let order:Uuid=sqlx::query_scalar("INSERT INTO orders(invoice_id,measurement_id,material_source,customer_material_description,material_amount,price,production_branch_id) VALUES($1,$2,'customer','Customer cotton',3,100,$3) RETURNING id").bind(invoice).bind(measurement).bind(production).fetch_one(db).await.unwrap();
        orders.push(order);
    }
    (invoice, orders, production, pickup)
}

pub async fn finish_stages(db: &PgPool, order: Uuid, pickup: Uuid) {
    sqlx::query("INSERT INTO order_stage_progress(order_id,stage_id,status,location_id) SELECT $1,id,'done',CASE WHEN requires_delivery THEN $2 ELSE NULL END FROM order_stages WHERE is_active").bind(order).bind(pickup).execute(db).await.unwrap();
}
