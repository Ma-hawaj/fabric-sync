use super::{service, types::*};
use crate::{error::AppError, features::campaigns, test_support};
use serde_json::{json, Value};
use sqlx::PgPool;

fn preference(granted: bool, reviewed: Option<&Value>) -> Value {
    json!({
        "granted": granted,
        "expectedMobile": reviewed.map(|r| &r["mobile"]),
        "expectedVersion": reviewed.map(|r| &r["consent"]["version"]),
    })
}

#[sqlx::test]
async fn one_customer_save_persists_both_preferences_and_automatic_audit(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let customer = service::create_customer(
        &state,
        serde_json::from_value(json!({
            "name":"Unified Customer", "mobileNo":"33112233", "whatsappNotificationsEnabled":false,
            "marketingPreference":preference(true, None)
        }))
        .unwrap(),
        Some("sales-user"),
    )
    .await
    .unwrap();
    assert!(!customer.whatsapp_notifications_enabled);
    let reviewed = campaigns::service::get_consent(&state, customer.id)
        .await
        .unwrap();
    assert_eq!(reviewed["consent"]["granted"], true);
    assert_eq!(reviewed["consent"]["recordedBy"], "sales-user");
    assert_eq!(
        reviewed["consent"]["source"],
        "Staff saved customer form promotions checkbox"
    );
    let updated = service::update_customer(
        &state,
        customer.id,
        serde_json::from_value(json!({
            "name":"Updated Customer", "whatsappNotificationsEnabled":true,
            "marketingPreference":preference(false, Some(&reviewed))
        }))
        .unwrap(),
        Some("manager-user"),
    )
    .await
    .unwrap();
    assert_eq!(updated.name, "Updated Customer");
    assert!(updated.whatsapp_notifications_enabled);
    let current = campaigns::service::get_consent(&state, customer.id)
        .await
        .unwrap();
    assert_eq!(current["consent"]["granted"], false);
    assert_eq!(current["consent"]["recordedBy"], "manager-user");
    service::update_customer(
        &state,
        customer.id,
        serde_json::from_value(json!({"address":"New address"})).unwrap(),
        None,
    )
    .await
    .unwrap();
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM marketing_consent_events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(events, 2);
    assert_eq!(
        campaigns::service::get_consent(&state, customer.id)
            .await
            .unwrap()["consent"]["version"],
        current["consent"]["version"]
    );
}

#[sqlx::test]
async fn failed_marketing_save_rolls_back_customer_details_and_creation(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let customer = service::create_customer(
        &state,
        serde_json::from_value(json!({"name":"Original", "mobileNo":"33112233"})).unwrap(),
        None,
    )
    .await
    .unwrap();
    let reviewed = campaigns::service::get_consent(&state, customer.id)
        .await
        .unwrap();
    let mut stale = preference(true, Some(&reviewed));
    stale["expectedMobile"] = json!("+97333991122");
    let error = service::update_customer(
        &state,
        customer.id,
        serde_json::from_value(json!({
            "name":"Should roll back", "mobileNo":"33991122", "whatsappNotificationsEnabled":false,
            "marketingPreference":stale
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AppError::Conflict(_)));
    let unchanged = service::get_customer(&state, customer.id).await.unwrap();
    assert_eq!(unchanged.name, "Original");
    assert_eq!(unchanged.mobile_no, "33112233");
    assert!(unchanged.whatsapp_notifications_enabled);
    let result = service::create_customer(&state, serde_json::from_value(json!({
        "name":"Invalid marketing number", "mobileNo":"123", "marketingPreference":preference(true,None)
    })).unwrap(), Some("sales")).await;
    assert!(matches!(result, Err(AppError::BadRequest(_))));
    let customers: i64 = sqlx::query_scalar("SELECT count(*) FROM customers")
        .fetch_one(&pool)
        .await
        .unwrap();
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM marketing_consent_events")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(customers, 1);
    assert_eq!(events, 0);
    // Non-WhatsApp numbers remain usable when promotions are off.
    service::create_customer(
        &state,
        serde_json::from_value(json!({
            "name":"No promotions", "mobileNo":"123", "marketingPreference":preference(false,None)
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap();
}

#[sqlx::test]
async fn checked_defaults_cannot_override_shared_number_opt_outs(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let opted_out = service::create_customer(
        &state,
        serde_json::from_value(json!({
            "name":"Opted out", "mobileNo":"33112233", "marketingPreference":preference(false,None)
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap();
    let original = campaigns::service::get_consent(&state, opted_out.id)
        .await
        .unwrap();
    let shared = service::create_customer(&state, serde_json::from_value(json!({
        "name":"Shared number", "mobileNo":"+973 3311 2233", "marketingPreference":preference(true,None)
    })).unwrap(), Some("sales")).await.unwrap();
    assert_eq!(
        campaigns::service::get_consent(&state, shared.id)
            .await
            .unwrap()["consent"]["version"],
        original["consent"]["version"]
    );
    let another = service::create_customer(&state, serde_json::from_value(json!({
        "name":"Changing number", "mobileNo":"33991122", "marketingPreference":preference(true,None)
    })).unwrap(), Some("sales")).await.unwrap();
    let reviewed = campaigns::service::get_consent(&state, another.id)
        .await
        .unwrap();
    let changed = service::update_customer(
        &state,
        another.id,
        serde_json::from_value(json!({
            "mobileNo":"33112233", "marketingPreference":preference(true,Some(&reviewed))
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap();
    assert_eq!(changed.mobile_no, "33112233");
    let current = campaigns::service::get_consent(&state, changed.id)
        .await
        .unwrap();
    assert_eq!(current["consent"]["granted"], false);
    assert_eq!(
        current["consent"]["version"],
        original["consent"]["version"]
    );
}

#[sqlx::test]
async fn stale_customer_forms_cannot_undo_a_later_withdrawal(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let customer = service::create_customer(
        &state,
        serde_json::from_value(json!({
            "name":"Original", "mobileNo":"33112233", "marketingPreference":preference(true,None)
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap();
    let reviewed = campaigns::service::get_consent(&state, customer.id)
        .await
        .unwrap();
    campaigns::service::consent(
        &state,
        customer.id,
        serde_json::from_value(json!({"expectedMobile":"+97333112233","granted":false})).unwrap(),
        "withdrawal",
    )
    .await
    .unwrap();
    let error = service::update_customer(
        &state,
        customer.id,
        serde_json::from_value(json!({
            "name":"Stale edit", "marketingPreference":preference(true,Some(&reviewed))
        }))
        .unwrap(),
        Some("sales"),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, AppError::Conflict(_)));
    assert_eq!(
        service::get_customer(&state, customer.id)
            .await
            .unwrap()
            .name,
        "Original"
    );
    service::update_customer(
        &state,
        customer.id,
        serde_json::from_value(json!({"address":"Address only"})).unwrap(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        campaigns::service::get_consent(&state, customer.id)
            .await
            .unwrap()["consent"]["granted"],
        false
    );
}

#[sqlx::test]
async fn customer_write_access_alone_does_not_grant_marketing_access(pool: PgPool) {
    let state = test_support::state(pool.clone(), None, None).await;
    let input: CreateCustomerInput = serde_json::from_value(json!({
        "name":"Not authorized", "mobileNo":"33112233", "marketingPreference":preference(true,None)
    }))
    .unwrap();
    assert!(matches!(
        service::create_customer(&state, input, None).await,
        Err(AppError::Forbidden(_))
    ));
    let customer = service::create_customer(
        &state,
        serde_json::from_value(json!({"name":"Production customer","mobileNo":"33112233"}))
            .unwrap(),
        None,
    )
    .await
    .unwrap();
    let input: UpdateCustomerInput = serde_json::from_value(json!({
        "name":"Must not change", "marketingPreference":preference(true,None)
    }))
    .unwrap();
    assert!(matches!(
        service::update_customer(&state, customer.id, input, None).await,
        Err(AppError::Forbidden(_))
    ));
    assert_eq!(
        service::get_customer(&state, customer.id)
            .await
            .unwrap()
            .name,
        "Production customer"
    );
    assert!(campaigns::service::get_consent(&state, customer.id)
        .await
        .unwrap()["consent"]
        .is_null());
}
