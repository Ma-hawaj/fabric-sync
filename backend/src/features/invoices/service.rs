use crate::{
    error::AppError, features::customers::repository as customers_repository, state::AppState,
};

use super::{
    repository,
    types::{CreateInvoiceInput, CreatedInvoice, DiscountUnit, InvoiceCustomerInput},
};

// Matches the frontend's invoice summary; the stored total is
// (subtotal - discount) + VAT, floored at zero before tax.
const VAT_RATE: f64 = 0.15;

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn compute_total(input: &CreateInvoiceInput) -> f64 {
    let subtotal: f64 = input
        .customers
        .iter()
        .flat_map(|customer| &customer.orders)
        .map(|order| order.price)
        .sum();

    let discount_amount = match input.discount_unit {
        DiscountUnit::Sar => input.discount,
        DiscountUnit::Percent => subtotal * input.discount / 100.0,
    };

    let taxable = (subtotal - discount_amount).max(0.0);
    round2(taxable * (1.0 + VAT_RATE))
}

fn validate(input: &CreateInvoiceInput) -> Result<(), AppError> {
    if input.customers.is_empty() {
        return Err(AppError::BadRequest(
            "an invoice needs at least one customer".to_string(),
        ));
    }

    for customer in &input.customers {
        match (&customer.existing_customer_id, &customer.new_customer) {
            (Some(_), Some(_)) | (None, None) => {
                return Err(AppError::BadRequest(
                    "each invoice customer needs exactly one of existingCustomerId or newCustomer"
                        .to_string(),
                ));
            }
            _ => {}
        }

        if customer.orders.is_empty() {
            return Err(AppError::BadRequest(
                "each invoice customer needs at least one order".to_string(),
            ));
        }
    }

    Ok(())
}

async fn resolve_customer_id(
    tx: &mut sqlx::PgTransaction<'_>,
    customer: &InvoiceCustomerInput,
) -> Result<uuid::Uuid, AppError> {
    match (&customer.existing_customer_id, &customer.new_customer) {
        (Some(id), None) => Ok(*id),
        (None, Some(new_customer)) => Ok(customers_repository::insert_customer(
            tx,
            &new_customer.name,
            &new_customer.mobile_no,
        )
        .await?),
        // Already rejected by validate().
        _ => unreachable!("validated: exactly one of existing/new customer is set"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(json: serde_json::Value) -> CreateInvoiceInput {
        serde_json::from_value(json).unwrap()
    }

    fn order(price: f64) -> serde_json::Value {
        serde_json::json!({
            "materialId": "0197fdd2-6a67-7000-8000-000000000001",
            "materialAmount": 2.0,
            "price": price,
        })
    }

    fn customer(orders: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({
            "existingCustomerId": "0197fdd2-6a67-7000-8000-000000000002",
            "measurement": { "date": "2026-07-19" },
            "orders": orders,
        })
    }

    fn invoice(
        discount: f64,
        discount_unit: &str,
        customers: Vec<serde_json::Value>,
    ) -> CreateInvoiceInput {
        input(serde_json::json!({
            "date": "2026-07-19",
            "discount": discount,
            "discountUnit": discount_unit,
            "paymentStatus": "unpaid",
            "customers": customers,
        }))
    }

    #[test]
    fn total_adds_vat_on_top_of_summed_order_prices() {
        let input = invoice(0.0, "SAR", vec![customer(vec![order(100.0), order(100.0)])]);
        assert_eq!(compute_total(&input), 230.0);
    }

    #[test]
    fn flat_discount_is_subtracted_before_vat() {
        let input = invoice(50.0, "SAR", vec![customer(vec![order(150.0)])]);
        assert_eq!(compute_total(&input), 115.0);
    }

    #[test]
    fn percentage_discount_applies_to_the_subtotal() {
        let input = invoice(10.0, "%", vec![customer(vec![order(200.0)])]);
        assert_eq!(compute_total(&input), 207.0);
    }

    #[test]
    fn discount_larger_than_subtotal_floors_at_zero() {
        let input = invoice(500.0, "SAR", vec![customer(vec![order(100.0)])]);
        assert_eq!(compute_total(&input), 0.0);
    }

    #[test]
    fn rejects_customer_with_both_existing_id_and_new_customer() {
        let mut invoice = invoice(0.0, "SAR", vec![customer(vec![order(100.0)])]);
        invoice.customers[0].new_customer = Some(super::super::types::NewCustomerInput {
            name: "Ahmed".to_string(),
            mobile_no: "0500000000".to_string(),
        });
        assert!(validate(&invoice).is_err());
    }

    #[test]
    fn rejects_customer_with_no_orders() {
        let invoice = invoice(0.0, "SAR", vec![customer(vec![])]);
        assert!(validate(&invoice).is_err());
    }

    #[test]
    fn rejects_invoice_with_no_customers() {
        let invoice = invoice(0.0, "SAR", vec![]);
        assert!(validate(&invoice).is_err());
    }
}

pub async fn create_invoice(
    state: &AppState,
    input: CreateInvoiceInput,
) -> Result<CreatedInvoice, AppError> {
    validate(&input)?;

    let total_price = compute_total(&input);

    let mut tx = state.db().begin().await?;

    let invoice_id = repository::insert_invoice(&mut tx, &input, total_price).await?;

    for customer in &input.customers {
        let customer_id = resolve_customer_id(&mut tx, customer).await?;

        // An unknown existing_customer_id surfaces here as a foreign-key
        // violation, which the AppError conversion maps to a 400.
        let measurement_id =
            customers_repository::insert_measurement(&mut tx, customer_id, &customer.measurement)
                .await?;

        for order in &customer.orders {
            repository::insert_order(&mut tx, invoice_id, measurement_id, order).await?;
        }
    }

    tx.commit().await?;

    Ok(CreatedInvoice {
        id: invoice_id,
        total_price,
    })
}
