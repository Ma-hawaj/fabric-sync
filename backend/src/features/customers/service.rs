use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{
        normalize_customer_identity, normalized_field, validate_measurement, CreateCustomerInput,
        Customer, UpdateCustomerInput,
    },
};

pub async fn list_customers(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<Customer>, AppError> {
    repository::list_customers(state, params).await
}

pub async fn get_customer(state: &AppState, customer_id: Uuid) -> Result<Customer, AppError> {
    repository::get_customer(state, customer_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("customer {customer_id} not found")))
}

pub async fn create_customer(
    state: &AppState,
    input: CreateCustomerInput,
) -> Result<Customer, AppError> {
    let (name, mobile_no) = normalize_customer_identity(&input.name, &input.mobile_no)?;

    if let Some(measurement) = input.measurement.as_ref() {
        validate_measurement(measurement)?;
    }

    let customer_id = repository::create_customer(
        state,
        &name,
        &mobile_no,
        input.whatsapp_notifications_enabled,
        input.address.as_deref(),
        input.measurement.as_ref(),
    )
    .await?;

    let customer = repository::get_customer(state, customer_id)
        .await?
        .expect("customer was just created");

    tracing::info!(customer_id = %customer.id, "customer created");

    Ok(customer)
}

pub async fn update_customer(
    state: &AppState,
    customer_id: Uuid,
    input: UpdateCustomerInput,
) -> Result<Customer, AppError> {
    let name = input
        .name
        .as_deref()
        .map(|name| normalized_field(name, "customer name"))
        .transpose()?;
    let mobile_no = input
        .mobile_no
        .as_deref()
        .map(|mobile_no| normalized_field(mobile_no, "phone number"))
        .transpose()?;

    if name.is_none()
        && mobile_no.is_none()
        && input.whatsapp_notifications_enabled.is_none()
        && input.address.is_none()
    {
        return Err(AppError::BadRequest("nothing to update".to_string()));
    }

    let customer = repository::update_customer(
        state,
        customer_id,
        name.as_deref(),
        mobile_no.as_deref(),
        input.whatsapp_notifications_enabled,
        input.address.as_deref(),
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("customer {customer_id} not found")))?;

    tracing::info!(customer_id = %customer_id, "customer updated");

    Ok(customer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_customer_identity_trims_both_fields() {
        assert_eq!(
            normalize_customer_identity("  Ahmed  ", "  33112233\n").unwrap(),
            ("Ahmed".to_string(), "33112233".to_string())
        );
    }

    #[test]
    fn normalized_field_trims_surrounding_whitespace() {
        assert_eq!(
            normalized_field("  Layla Haddad \n", "customer name").unwrap(),
            "Layla Haddad"
        );
    }

    #[test]
    fn normalized_field_rejects_blank_values() {
        for value in ["", "   ", "\t\n"] {
            let error = normalized_field(value, "customer name").unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{value:?}");
        }
    }

    #[sqlx::test]
    async fn multiline_addresses_are_trimmed_and_blank_addresses_clear(pool: sqlx::PgPool) {
        let state = crate::test_support::state(pool, None, None).await;
        for (index, blank) in ["", "   ", "\r\n\t", "\u{2003}\u{a0}\t\n"]
            .iter()
            .enumerate()
        {
            let customer = create_customer(
                &state,
                serde_json::from_value(serde_json::json!({
                    "name": format!("Address customer {index}"), "mobileNo": "33112233",
                    "address": blank,
                }))
                .unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(customer.address, None);

            let updated = update_customer(
                &state,
                customer.id,
                serde_json::from_value(serde_json::json!({
                    "address": "\n\t Building 10\nRoad 20, Manama \r\n\u{2003}",
                }))
                .unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(
                updated.address.as_deref(),
                Some("Building 10\nRoad 20, Manama")
            );

            let preserved = update_customer(
                &state,
                customer.id,
                serde_json::from_value(serde_json::json!({"whatsappNotificationsEnabled": false}))
                    .unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(preserved.address, updated.address);

            let cleared = update_customer(
                &state,
                customer.id,
                serde_json::from_value(serde_json::json!({"address": blank})).unwrap(),
            )
            .await
            .unwrap();
            assert_eq!(cleared.address, None);
        }
    }

    #[sqlx::test]
    async fn creation_defaults_to_whatsapp_updates_and_accepts_an_opt_out(pool: sqlx::PgPool) {
        let state = crate::test_support::state(pool, None, None).await;
        let customer = create_customer(
            &state,
            serde_json::from_value(serde_json::json!({
                "name": "Default preference", "mobileNo": "33112233"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert!(customer.whatsapp_notifications_enabled);

        let opted_out = create_customer(
            &state,
            serde_json::from_value(serde_json::json!({
                "name": "Opted out", "mobileNo": "33991122",
                "whatsappNotificationsEnabled": false
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert!(!opted_out.whatsapp_notifications_enabled);
        assert!(
            !get_customer(&state, opted_out.id)
                .await
                .unwrap()
                .whatsapp_notifications_enabled
        );
    }

    #[sqlx::test]
    async fn customer_save_updates_the_preference_and_invalidates_invoice_previews(
        pool: sqlx::PgPool,
    ) {
        let (invoice, _, _, _) = crate::test_support::invoice(&pool, 1, false).await;
        let customer_id: Uuid = sqlx::query_scalar("SELECT customer_id FROM measurements LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let before: i64 =
            sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
                .bind(invoice)
                .fetch_one(&pool)
                .await
                .unwrap();
        let state = crate::test_support::state(pool.clone(), None, None).await;
        let saved = update_customer(
            &state,
            customer_id,
            serde_json::from_value(serde_json::json!({
                "name": "Updated customer", "mobileNo": "33991122",
                "whatsappNotificationsEnabled": false
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(saved.name, "Updated customer");
        assert_eq!(saved.mobile_no, "33991122");
        assert!(!saved.whatsapp_notifications_enabled);
        let after: i64 =
            sqlx::query_scalar("SELECT notification_revision FROM invoices WHERE id=$1")
                .bind(invoice)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(after > before);

        let renamed = update_customer(
            &state,
            customer_id,
            serde_json::from_value(serde_json::json!({"name": "Renamed"})).unwrap(),
        )
        .await
        .unwrap();
        assert!(!renamed.whatsapp_notifications_enabled);
        let enabled = update_customer(
            &state,
            customer_id,
            serde_json::from_value(serde_json::json!({"whatsappNotificationsEnabled": true}))
                .unwrap(),
        )
        .await
        .unwrap();
        assert!(enabled.whatsapp_notifications_enabled);
        assert_eq!(enabled.name, "Renamed");
    }

    #[sqlx::test]
    async fn conflicting_customer_details_do_not_persist_the_preference(pool: sqlx::PgPool) {
        crate::test_support::invoice(&pool, 1, false).await;
        let state = crate::test_support::state(pool, None, None).await;
        let customer = create_customer(
            &state,
            serde_json::from_value(serde_json::json!({
                "name": "Other customer", "mobileNo": "33991122"
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        let result = update_customer(
            &state,
            customer.id,
            serde_json::from_value(serde_json::json!({
                "name": "First Customer", "mobileNo": "33112233",
                "whatsappNotificationsEnabled": false
            }))
            .unwrap(),
        )
        .await;
        assert!(matches!(result, Err(AppError::Conflict(_))));
        let unchanged = get_customer(&state, customer.id).await.unwrap();
        assert_eq!(unchanged.name, customer.name);
        assert_eq!(unchanged.mobile_no, customer.mobile_no);
        assert!(unchanged.whatsapp_notifications_enabled);
    }
}
