use std::collections::HashSet;

use crate::{
    error::AppError,
    features::{
        customers::{repository as customers_repository, types::measurement_values_equal},
        gift_cards::{repository as gift_cards_repository, service as gift_cards_service},
        products::repository as products_repository,
    },
    state::AppState,
};

use super::{
    repository,
    types::{
        CreateInvoiceInput, CreateProductLineInput, CreatedInvoice, DiscountUnit,
        InvoiceCustomerInput, InvoiceListItem,
    },
};

pub async fn list_invoices(state: &AppState) -> Result<Vec<InvoiceListItem>, AppError> {
    Ok(repository::list_invoices(state).await?)
}

// Matches the frontend's invoice summary; the stored total is
// (subtotal - discount) + VAT, floored at zero before tax.
const VAT_RATE: f64 = 0.15;

fn round2(value: f64) -> f64 {
    // The trailing `+ 0.0` normalizes negative zero: std's `Sum` for floats
    // folds from `-0.0` (the true additive identity), so summing an empty list
    // of lines yields `-0.0` and would serialize as `-0.0` in the response.
    (value * 100.0).round() / 100.0 + 0.0
}

// Unlike an order, whose price is the whole line, a product line is priced per
// unit and multiplied out.
fn product_line_total(line: &CreateProductLineInput) -> f64 {
    round2(line.quantity * line.unit_price)
}

/// What an invoice comes to. `total` is the gross amount charged with VAT
/// included; `redeemed` is gift card tender applied against it, kept separate
/// so `total_price` keeps meaning "what this sale was worth" regardless of how
/// it was paid for.
struct InvoiceTotals {
    total: f64,
    redeemed: f64,
}

fn compute_totals(input: &CreateInvoiceInput) -> InvoiceTotals {
    let order_subtotal: f64 = input
        .customers
        .iter()
        .flat_map(|customer| &customer.orders)
        .map(|order| order.price)
        .sum();

    let product_subtotal: f64 = input.products.iter().map(product_line_total).sum();
    let taxable_subtotal = order_subtotal + product_subtotal;

    let discount_amount = match input.discount_unit {
        DiscountUnit::Amount => input.discount,
        DiscountUnit::Percent => taxable_subtotal * input.discount / 100.0,
    };

    let taxable = (taxable_subtotal - discount_amount).max(0.0);

    // Selling stored value is not a taxable supply — VAT is charged when the
    // card is spent — so a gift card's face value is neither discounted nor
    // taxed. It is simply added to what the customer owes.
    let gift_card_sales: f64 = input.gift_cards.iter().map(|card| card.amount).sum();

    InvoiceTotals {
        total: round2(taxable * (1.0 + VAT_RATE) + gift_card_sales),
        redeemed: round2(
            input
                .gift_card_redemptions
                .iter()
                .map(|redemption| redemption.amount)
                .sum(),
        ),
    }
}

fn validate(input: &CreateInvoiceInput) -> Result<(), AppError> {
    let has_orders = input
        .customers
        .iter()
        .any(|customer| !customer.orders.is_empty());

    if !has_orders && input.products.is_empty() && input.gift_cards.is_empty() {
        return Err(AppError::BadRequest(
            "an invoice needs at least one order, product, or gift card".to_string(),
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

        // A customer block exists to carry orders and a measurement snapshot;
        // an empty one would write a measurement nothing references.
        if customer.orders.is_empty() {
            return Err(AppError::BadRequest(
                "each invoice customer needs at least one order".to_string(),
            ));
        }
    }

    for line in &input.products {
        if line.quantity <= 0.0 {
            return Err(AppError::BadRequest(
                "a product line needs a quantity greater than zero".to_string(),
            ));
        }

        if line.unit_price < 0.0 {
            return Err(AppError::BadRequest(
                "a product price cannot be negative".to_string(),
            ));
        }
    }

    for card in &input.gift_cards {
        gift_cards_service::normalize_code(&card.code)?;
        gift_cards_service::validate_amount(card.amount)?;
    }

    let mut redeemed_codes = HashSet::new();
    for redemption in &input.gift_card_redemptions {
        let code = gift_cards_service::normalize_code(&redemption.code)?;
        gift_cards_service::validate_amount(redemption.amount)?;

        if !redeemed_codes.insert(code) {
            return Err(AppError::BadRequest(
                "the same gift card cannot be applied twice to one invoice".to_string(),
            ));
        }
    }

    // Gift cards are tender, so they can settle an invoice but never overpay
    // it — the excess would be change the card can't give back.
    let totals = compute_totals(input);
    if totals.redeemed > totals.total {
        return Err(AppError::BadRequest(
            "gift cards cover more than the invoice total".to_string(),
        ));
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

    fn product(quantity: f64, unit_price: f64) -> serde_json::Value {
        serde_json::json!({
            "productId": "0197fdd2-6a67-7000-8000-000000000003",
            "quantity": quantity,
            "unitPrice": unit_price,
            "branchId": "0197fdd2-6a67-7000-8000-000000000004",
        })
    }

    fn gift_card(amount: f64) -> serde_json::Value {
        serde_json::json!({ "code": "GC-1", "amount": amount })
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

    // A sale with no tailoring at all: the customer blocks are gone and the
    // lines are whatever is passed in.
    fn retail_invoice(extra: serde_json::Value) -> CreateInvoiceInput {
        let mut base = serde_json::json!({
            "date": "2026-07-19",
            "discountUnit": "amount",
            "paymentStatus": "unpaid",
        });

        let object = base.as_object_mut().unwrap();
        for (key, value) in extra.as_object().unwrap() {
            object.insert(key.clone(), value.clone());
        }

        input(base)
    }

    #[test]
    fn total_adds_vat_on_top_of_summed_order_prices() {
        let input = invoice(
            0.0,
            "amount",
            vec![customer(vec![order(100.0), order(100.0)])],
        );
        assert_eq!(compute_totals(&input).total, 230.0);
    }

    #[test]
    fn flat_discount_is_subtracted_before_vat() {
        let input = invoice(50.0, "amount", vec![customer(vec![order(150.0)])]);
        assert_eq!(compute_totals(&input).total, 115.0);
    }

    #[test]
    fn percentage_discount_applies_to_the_subtotal() {
        let input = invoice(10.0, "percent", vec![customer(vec![order(200.0)])]);
        assert_eq!(compute_totals(&input).total, 207.0);
    }

    #[test]
    fn discount_larger_than_subtotal_floors_at_zero() {
        let input = invoice(500.0, "amount", vec![customer(vec![order(100.0)])]);
        assert_eq!(compute_totals(&input).total, 0.0);
    }

    #[test]
    fn a_product_line_is_priced_per_unit_and_taxed_like_an_order() {
        let input = retail_invoice(serde_json::json!({ "products": [product(3.0, 40.0)] }));
        // 3 × 40 = 120, + 15% = 138
        assert_eq!(compute_totals(&input).total, 138.0);
    }

    #[test]
    fn products_and_orders_share_one_taxable_subtotal() {
        let mut input = invoice(0.0, "amount", vec![customer(vec![order(100.0)])]);
        input.products = serde_json::from_value(serde_json::json!([product(1.0, 100.0)])).unwrap();
        // (100 + 100) × 1.15 = 230
        assert_eq!(compute_totals(&input).total, 230.0);
    }

    #[test]
    fn a_gift_card_sale_is_added_at_face_value_without_vat() {
        let input = retail_invoice(serde_json::json!({ "giftCards": [gift_card(200.0)] }));
        assert_eq!(compute_totals(&input).total, 200.0);
    }

    #[test]
    fn vat_applies_only_to_the_goods_sold_alongside_a_gift_card() {
        let input = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCards": [gift_card(200.0)],
        }));
        // 100 × 1.15 = 115, plus the card's untaxed 200
        assert_eq!(compute_totals(&input).total, 315.0);
    }

    #[test]
    fn a_percentage_discount_does_not_reach_gift_card_sales() {
        let mut input = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCards": [gift_card(200.0)],
        }));
        input.discount = 10.0;
        input.discount_unit = DiscountUnit::Percent;
        // 10% off the 100 of goods only: 90 × 1.15 = 103.5, plus 200
        assert_eq!(compute_totals(&input).total, 303.5);
    }

    #[test]
    fn an_invoice_with_nothing_to_redeem_reports_a_positive_zero() {
        let input = retail_invoice(serde_json::json!({ "products": [product(1.0, 100.0)] }));
        // -0.0 == 0.0, so this checks the sign bit rather than the value: a
        // negative zero would reach the client as "-0.0".
        assert!(compute_totals(&input).redeemed.is_sign_positive());
    }

    #[test]
    fn redeeming_a_gift_card_does_not_change_the_invoice_total() {
        let input = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCardRedemptions": [{ "code": "GC-1", "amount": 50.0 }],
        }));
        let totals = compute_totals(&input);
        assert_eq!(totals.total, 115.0);
        assert_eq!(totals.redeemed, 50.0);
    }

    #[test]
    fn rejects_customer_with_both_existing_id_and_new_customer() {
        let mut invoice = invoice(0.0, "amount", vec![customer(vec![order(100.0)])]);
        invoice.customers[0].new_customer = Some(super::super::types::NewCustomerInput {
            name: "Ahmed".to_string(),
            mobile_no: "0500000000".to_string(),
        });
        assert!(validate(&invoice).is_err());
    }

    #[test]
    fn rejects_customer_with_no_orders() {
        let invoice = invoice(0.0, "amount", vec![customer(vec![])]);
        assert!(validate(&invoice).is_err());
    }

    #[test]
    fn rejects_invoice_with_no_customers() {
        let invoice = invoice(0.0, "amount", vec![]);
        assert!(validate(&invoice).is_err());
    }

    #[test]
    fn accepts_an_invoice_of_only_products() {
        let invoice = retail_invoice(serde_json::json!({ "products": [product(2.0, 30.0)] }));
        assert!(validate(&invoice).is_ok());
    }

    #[test]
    fn accepts_an_invoice_of_only_gift_cards() {
        let invoice = retail_invoice(serde_json::json!({ "giftCards": [gift_card(150.0)] }));
        assert!(validate(&invoice).is_ok());
    }

    #[test]
    fn rejects_an_invoice_with_no_lines_of_any_kind() {
        let invoice = retail_invoice(serde_json::json!({}));
        let error = validate(&invoice).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn rejects_a_product_line_without_a_quantity() {
        for quantity in [0.0, -1.0] {
            let invoice =
                retail_invoice(serde_json::json!({ "products": [product(quantity, 30.0)] }));
            let error = validate(&invoice).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{quantity}");
        }
    }

    #[test]
    fn rejects_the_same_gift_card_applied_twice_to_one_invoice() {
        let invoice = retail_invoice(serde_json::json!({
            "products": [product(1.0, 500.0)],
            "giftCardRedemptions": [
                { "code": "GC-1", "amount": 50.0 },
                { "code": " gc-1 ", "amount": 25.0 },
            ],
        }));
        let error = validate(&invoice).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn rejects_redemptions_worth_more_than_the_invoice() {
        let invoice = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCardRedemptions": [{ "code": "GC-1", "amount": 200.0 }],
        }));
        let error = validate(&invoice).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn accepts_a_redemption_that_settles_the_invoice_exactly() {
        let invoice = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCardRedemptions": [{ "code": "GC-1", "amount": 115.0 }],
        }));
        assert!(validate(&invoice).is_ok());
    }
}

pub async fn create_invoice(
    state: &AppState,
    input: CreateInvoiceInput,
) -> Result<CreatedInvoice, AppError> {
    validate(&input)?;

    let totals = compute_totals(&input);

    let mut tx = state.db().begin().await?;

    let invoice_id =
        repository::insert_invoice(&mut tx, &input, totals.total, totals.redeemed).await?;

    for customer in &input.customers {
        let customer_id = resolve_customer_id(&mut tx, customer).await?;

        // An unknown existing_customer_id surfaces here as a foreign-key
        // violation, which the AppError conversion maps to a 400.
        let latest = customers_repository::latest_measurement(&mut tx, customer_id).await?;
        let measurement_id = match latest {
            Some((id, ref values)) if measurement_values_equal(values, &customer.measurement) => id,
            _ => {
                customers_repository::insert_measurement(
                    &mut tx,
                    customer_id,
                    &customer.measurement,
                )
                .await?
            }
        };

        for order in &customer.orders {
            repository::insert_order(&mut tx, invoice_id, measurement_id, order).await?;
        }
    }

    for line in &input.products {
        // The decrement is guarded in SQL, so `None` means the location either
        // never stocked this product or no longer holds enough of it. Reading
        // the name for the message costs an extra query only on that path.
        let description = products_repository::decrement_stock(
            &mut tx,
            line.product_id,
            line.branch_id,
            line.quantity,
        )
        .await?;

        let Some(description) = description else {
            let name = products_repository::product_name(&mut tx, line.product_id)
                .await?
                .ok_or_else(|| {
                    AppError::BadRequest(format!("no product with id {}", line.product_id))
                })?;

            return Err(AppError::BadRequest(format!(
                "not enough {name} in stock at the selected location"
            )));
        };

        repository::insert_product_item(
            &mut tx,
            invoice_id,
            line,
            &description,
            product_line_total(line),
        )
        .await?;
    }

    for card in &input.gift_cards {
        let code = gift_cards_service::normalize_code(&card.code)?;

        let gift_card_id = gift_cards_repository::insert_gift_card(
            &mut tx,
            &code,
            card.amount,
            // The card belongs to whoever the invoice is billed to, when the
            // sale names someone at all.
            input.customer_id,
            card.expires_on,
        )
        .await?;

        repository::insert_gift_card_item(
            &mut tx,
            invoice_id,
            gift_card_id,
            &format!("Gift card {code}"),
            card.amount,
        )
        .await?;
    }

    for redemption in &input.gift_card_redemptions {
        let code = gift_cards_service::normalize_code(&redemption.code)?;
        let gift_card_id =
            gift_cards_service::redeem(&mut tx, &code, redemption.amount, input.date).await?;

        gift_cards_repository::insert_redemption(
            &mut tx,
            gift_card_id,
            invoice_id,
            redemption.amount,
        )
        .await?;
    }

    tx.commit().await?;

    Ok(CreatedInvoice {
        id: invoice_id,
        total_price: totals.total,
        gift_card_redeemed: totals.redeemed,
    })
}
