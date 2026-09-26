use std::collections::{HashMap, HashSet};

use chrono::NaiveDate;

use crate::{
    error::AppError,
    features::{
        customers::{repository as customers_repository, types::measurement_values_equal},
        gift_cards::{repository as gift_cards_repository, service as gift_cards_service},
        materials::repository as materials_repository,
        products::repository as products_repository,
    },
    list::{self, ListParams},
    state::AppState,
};

use uuid::Uuid;

use super::{
    repository,
    types::{
        CreateGiftCardLineInput, CreateInvoiceInput, CreateOrderInput, CreateProductLineInput,
        CreatedInvoice, DiscountUnit, GiftCardRedemptionInput, InvoiceCustomerInput, InvoiceDetail,
        InvoiceEdit, InvoiceListItem, InvoiceTotalsBreakdown, PaymentSummary, PaymentType,
        ReceivedInvoice, RecordedPayment,
    },
};
use crate::features::customers::types::CreateMeasurementInput;

pub async fn list_invoices(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<InvoiceListItem>, AppError> {
    repository::list_invoices(state, params).await
}

/// Reads one invoice with its lines and the arithmetic behind its total.
pub async fn get_invoice(state: &AppState, invoice_id: Uuid) -> Result<InvoiceDetail, AppError> {
    let rows = repository::fetch_invoice_detail(state, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;

    let invoice = rows.invoice;

    // The stored row keeps only the total, the discount and its unit, so the
    // figures in between are rebuilt from the lines. Splitting them by
    // `taxable` is what keeps gift card sales out of the VAT base, exactly as
    // compute_totals does on the way in.
    let taxable_subtotal: f64 = rows
        .lines
        .iter()
        .filter(|line| line.taxable)
        .map(|line| line.line_total)
        .sum();
    let gift_card_sales: f64 = rows
        .lines
        .iter()
        .filter(|line| !line.taxable)
        .map(|line| line.line_total)
        .sum();

    let discount_unit = match invoice.discount_unit.as_str() {
        "percent" => DiscountUnit::Percent,
        _ => DiscountUnit::Amount,
    };
    let totals = breakdown(
        taxable_subtotal,
        gift_card_sales,
        invoice.discount,
        discount_unit,
    );

    let payments = repository::list_payments(state, invoice_id).await?;

    Ok(InvoiceDetail {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        date: invoice.date,
        created_at: invoice.created_at,
        branch_name: invoice.branch_name,
        buyer: invoice.buyer,
        payment_status: invoice.payment_status,
        payment_method: invoice.payment_method,
        lines: rows.lines,
        redemptions: rows.redemptions,
        payments,
        totals: InvoiceTotalsBreakdown {
            subtotal: totals.subtotal,
            discount: invoice.discount,
            discount_unit: invoice.discount_unit,
            discount_amount: totals.discount_amount,
            taxable: totals.taxable,
            vat_rate: VAT_RATE,
            vat: totals.vat,
            gift_card_sales: totals.gift_card_sales,
            // The recomputed total and the stored one agree by construction —
            // same function, same inputs — but the stored figure is what was
            // actually charged, so it is the one that gets printed.
            total: invoice.total_price,
            gift_card_redeemed: invoice.gift_card_redeemed,
            amount_paid: invoice.amount_paid,
            balance_due: round2(
                (invoice.total_price - invoice.gift_card_redeemed - invoice.amount_paid).max(0.0),
            ),
        },
    })
}

/// The invoice's money state, derived from the ledger rather than stored:
/// `amount_paid` is the sum of every payment, and the status follows the
/// balance. Pure, so it can be tested without a database.
pub fn payment_summary(
    total_price: f64,
    gift_card_redeemed: f64,
    amount_paid: f64,
) -> PaymentSummary {
    let amount_paid = round2(amount_paid);
    let balance_due = round2((total_price - gift_card_redeemed - amount_paid).max(0.0));
    let payment_status = if balance_due == 0.0 {
        "paid"
    } else if amount_paid == 0.0 {
        "unpaid"
    } else {
        "partial"
    }
    .to_string();

    PaymentSummary {
        payment_status,
        amount_paid,
        balance_due,
    }
}

/// Rejects a payment that is not positive or that would take the ledger past
/// what the invoice charges. Callers hold the invoice row locked (`FOR
/// UPDATE`), so two concurrent payments serialize on this check.
pub fn validate_payment_amount(
    amount: f64,
    total_price: f64,
    gift_card_redeemed: f64,
    amount_paid: f64,
) -> Result<(), AppError> {
    if amount <= 0.0 {
        return Err(AppError::BadRequest(
            "a payment has to be greater than zero".to_string(),
        ));
    }

    let summary = payment_summary(total_price, gift_card_redeemed, amount_paid);
    // Rounded to fils first: float sums of two-decimal figures can sit an
    // epsilon above or below the true value.
    if round2(amount) - summary.balance_due > 1e-9 {
        return Err(AppError::BadRequest(
            "this payment is more than the invoice's remaining balance".to_string(),
        ));
    }

    Ok(())
}

/// A till payment: money taken without collecting anything — an extra advance
/// now, or the remainder after every order was already collected. When taken
/// at a pickup, `order_id` attributes it there, and must belong to this
/// invoice.
pub async fn record_payment(
    state: &AppState,
    invoice_id: Uuid,
    amount: f64,
    payment_type: PaymentType,
    order_id: Option<Uuid>,
) -> Result<RecordedPayment, AppError> {
    let mut tx = state.db().begin().await?;

    let locked = repository::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;

    if let Some(order_id) = order_id {
        if !repository::order_belongs_to_invoice(&mut tx, order_id, invoice_id).await? {
            return Err(AppError::NotFound(format!(
                "order {order_id} not found on invoice {invoice_id}"
            )));
        }
    }

    let paid = repository::sum_payments(&mut tx, invoice_id).await?;
    validate_payment_amount(amount, locked.total_price, locked.gift_card_redeemed, paid)?;

    let payment = repository::insert_payment(
        &mut tx,
        invoice_id,
        order_id,
        amount,
        Some(payment_type.as_str()),
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        invoice_id = %invoice_id,
        amount,
        payment_type = payment_type.as_str(),
        "payment recorded"
    );

    let summary = payment_summary(locked.total_price, locked.gift_card_redeemed, paid + amount);
    Ok(RecordedPayment { payment, summary })
}

/// Marks every order on the invoice received and settles the remaining
/// balance in one action — the whole-invoice counterpart to
/// features::orders::receive_order, for when everything is collected (and
/// paid) at once. Takes no money when nothing is left to pay.
pub async fn receive_invoice(
    state: &AppState,
    invoice_id: Uuid,
    payment_type: Option<PaymentType>,
) -> Result<ReceivedInvoice, AppError> {
    let mut tx = state.db().begin().await?;

    repository::mark_orders_received(&mut tx, invoice_id).await?;

    let locked = repository::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;

    let paid = repository::sum_payments(&mut tx, invoice_id).await?;
    let summary = payment_summary(locked.total_price, locked.gift_card_redeemed, paid);

    let payment_method = if summary.balance_due > 0.0 {
        let payment_type = payment_type.ok_or_else(|| {
            AppError::BadRequest("settling this invoice needs a paymentType".to_string())
        })?;
        repository::insert_payment(
            &mut tx,
            invoice_id,
            None,
            summary.balance_due,
            Some(payment_type.as_str()),
        )
        .await?;
        Some(payment_type.as_str().to_string())
    } else {
        if payment_type.is_some() {
            return Err(AppError::BadRequest(
                "this invoice is already fully paid".to_string(),
            ));
        }
        repository::latest_payment_method(&mut tx, invoice_id).await?
    };

    tx.commit().await?;

    let summary = payment_summary(
        locked.total_price,
        locked.gift_card_redeemed,
        paid + summary.balance_due,
    );

    tracing::info!(
        invoice_id = %invoice_id,
        amount_paid = summary.amount_paid,
        "invoice received"
    );

    Ok(ReceivedInvoice {
        id: invoice_id,
        payment_status: summary.payment_status,
        amount_paid: summary.amount_paid,
        balance_due: summary.balance_due,
        payment_method,
    })
}

// Matches the frontend's invoice summary. Line prices are entered gross —
// VAT included — so the stored total is (gross - discount), with VAT
// extracted from the discounted gross rather than added on top.
const VAT_RATE: f64 = 0.1;

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

/// Every figure between the line items and the total. Shared by the create
/// path, which stores `total`, and the read path behind `GET /invoices/:id`,
/// which has to rebuild the rest from the lines in order to print it — a
/// printed invoice has to show its VAT, and the invoices table never stored
/// it. One function so the two can't disagree.
pub struct Breakdown {
    pub subtotal: f64,
    pub discount_amount: f64,
    pub taxable: f64,
    pub vat: f64,
    pub gift_card_sales: f64,
    pub total: f64,
}

/// `taxable_gross` is everything VAT is included in — every order and product
/// line is entered gross, VAT included; `gift_card_sales` is the face value
/// of any cards sold, which is neither discounted nor taxed.
///
/// The discount comes off the gross (what the customer was actually quoted),
/// and VAT is extracted from the discounted gross: net is the gross deflated
/// by the rate, and VAT is the remainder. Computing VAT as the remainder —
/// rather than rounding `net * rate` — is what makes the printed document add
/// up: a reader checking taxable + VAT against the discounted gross gets the
/// number printed beside it, to the fils.
fn breakdown(
    taxable_gross: f64,
    gift_card_sales: f64,
    discount: f64,
    discount_unit: DiscountUnit,
) -> Breakdown {
    let subtotal = round2(taxable_gross);

    let discount_amount = round2(match discount_unit {
        DiscountUnit::Amount => discount,
        DiscountUnit::Percent => taxable_gross * discount / 100.0,
    })
    // A discount bigger than the sale doesn't turn into a refund.
    .min(subtotal);

    let gross = round2(subtotal - discount_amount);
    let taxable = round2(gross / (1.0 + VAT_RATE));
    let vat = round2(gross - taxable);
    let gift_card_sales = round2(gift_card_sales);

    Breakdown {
        subtotal,
        discount_amount,
        taxable,
        vat,
        gift_card_sales,
        total: round2(gross + gift_card_sales),
    }
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

    // Selling stored value is not a taxable supply — VAT is charged when the
    // card is spent — so a gift card's face value is neither discounted nor
    // taxed. It is simply added to what the customer owes.
    let gift_card_sales: f64 = input.gift_cards.iter().map(|card| card.amount).sum();

    let totals = breakdown(
        order_subtotal + product_subtotal,
        gift_card_sales,
        input.discount,
        input.discount_unit,
    );

    InvoiceTotals {
        total: totals.total,
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

    for payment in &input.payments {
        if payment.amount <= 0.0 {
            return Err(AppError::BadRequest(
                "a payment has to be greater than zero".to_string(),
            ));
        }
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

    // Up-front payments are capped the same way: the till can't take more
    // than the invoice charges.
    let paid: f64 = input.payments.iter().map(|payment| payment.amount).sum();
    if round2(paid) - round2(totals.total - totals.redeemed) > 1e-9 {
        return Err(AppError::BadRequest(
            "payments cover more than the invoice total".to_string(),
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
            "productionLocationId": "0197fdd2-6a67-7000-8000-000000000005",
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
    fn line_prices_are_gross_so_no_vat_is_added_on_top() {
        let input = invoice(
            0.0,
            "amount",
            vec![customer(vec![order(100.0), order(100.0)])],
        );
        assert_eq!(compute_totals(&input).total, 200.0);
    }

    #[test]
    fn flat_discount_comes_off_the_gross() {
        let input = invoice(50.0, "amount", vec![customer(vec![order(150.0)])]);
        assert_eq!(compute_totals(&input).total, 100.0);
    }

    #[test]
    fn percentage_discount_applies_to_the_gross() {
        let input = invoice(10.0, "percent", vec![customer(vec![order(200.0)])]);
        assert_eq!(compute_totals(&input).total, 180.0);
    }

    #[test]
    fn discount_larger_than_subtotal_floors_at_zero() {
        let input = invoice(500.0, "amount", vec![customer(vec![order(100.0)])]);
        assert_eq!(compute_totals(&input).total, 0.0);
    }

    #[test]
    fn a_product_line_is_priced_per_unit_and_gross_like_an_order() {
        let input = retail_invoice(serde_json::json!({ "products": [product(3.0, 40.0)] }));
        // 3 × 40 = 120 gross, VAT extracted rather than added
        assert_eq!(compute_totals(&input).total, 120.0);
    }

    #[test]
    fn products_and_orders_share_one_gross_subtotal() {
        let mut input = invoice(0.0, "amount", vec![customer(vec![order(100.0)])]);
        input.products = serde_json::from_value(serde_json::json!([product(1.0, 100.0)])).unwrap();
        assert_eq!(compute_totals(&input).total, 200.0);
    }

    #[test]
    fn a_gift_card_sale_is_added_at_face_value_without_vat() {
        let input = retail_invoice(serde_json::json!({ "giftCards": [gift_card(200.0)] }));
        assert_eq!(compute_totals(&input).total, 200.0);
    }

    #[test]
    fn vat_is_extracted_from_the_goods_sold_alongside_a_gift_card() {
        let input = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCards": [gift_card(200.0)],
        }));
        // 100 gross plus the card's untaxed 200
        assert_eq!(compute_totals(&input).total, 300.0);
    }

    #[test]
    fn a_percentage_discount_does_not_reach_gift_card_sales() {
        let mut input = retail_invoice(serde_json::json!({
            "products": [product(1.0, 100.0)],
            "giftCards": [gift_card(200.0)],
        }));
        input.discount = 10.0;
        input.discount_unit = DiscountUnit::Percent;
        // 10% off the 100 of gross goods only: 90, plus 200
        assert_eq!(compute_totals(&input).total, 290.0);
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
        assert_eq!(totals.total, 100.0);
        assert_eq!(totals.redeemed, 50.0);
    }

    // The breakdown is what the printed document shows, so what matters is
    // that its parts add up to the total printed beside them: the net and
    // the extracted VAT always sum back to the discounted gross.
    #[test]
    fn the_breakdown_splits_the_discounted_gross_into_net_and_vat() {
        let totals = breakdown(133.33, 0.0, 7.5, DiscountUnit::Percent);
        assert_eq!(totals.subtotal, 133.33);
        assert_eq!(totals.discount_amount, 10.0);
        // 123.33 gross deflates to a 112.12 net with 11.21 of VAT inside it.
        assert_eq!(totals.taxable, 112.12);
        assert_eq!(totals.vat, 11.21);
        // Summed in floats, so rounded before comparing: 112.12 + 11.21 is
        // 123.33000000000001 in f64, not 123.33.
        assert_eq!(
            round2(totals.taxable + totals.vat + totals.gift_card_sales),
            totals.total
        );
    }

    #[test]
    fn the_breakdown_reports_the_discount_it_actually_applied() {
        // Asking for 500 off a 100 sale discounts 100, not 500 — otherwise the
        // document would print a discount line that overshoots the subtotal.
        let totals = breakdown(100.0, 0.0, 500.0, DiscountUnit::Amount);
        assert_eq!(totals.discount_amount, 100.0);
        assert_eq!(totals.taxable, 0.0);
        assert_eq!(totals.vat, 0.0);
        assert_eq!(totals.total, 0.0);
    }

    #[test]
    fn gift_card_sales_stay_out_of_the_vat_base_but_inside_the_total() {
        let totals = breakdown(100.0, 200.0, 0.0, DiscountUnit::Amount);
        // 100 gross holds 90.91 of net and 9.09 of VAT; the card joins
        // the total untaxed.
        assert_eq!(totals.taxable, 90.91);
        assert_eq!(totals.vat, 9.09);
        assert_eq!(totals.gift_card_sales, 200.0);
        assert_eq!(totals.total, 300.0);
    }

    #[test]
    fn payment_summary_follows_the_balance() {
        let unpaid = payment_summary(200.0, 0.0, 0.0);
        assert_eq!(unpaid.payment_status, "unpaid");
        assert_eq!(unpaid.balance_due, 200.0);

        let partial = payment_summary(200.0, 0.0, 80.0);
        assert_eq!(partial.payment_status, "partial");
        assert_eq!(partial.amount_paid, 80.0);
        assert_eq!(partial.balance_due, 120.0);

        let paid = payment_summary(200.0, 0.0, 200.0);
        assert_eq!(paid.payment_status, "paid");
        assert_eq!(paid.balance_due, 0.0);
    }

    #[test]
    fn gift_card_tender_counts_towards_settlement() {
        let summary = payment_summary(300.0, 200.0, 100.0);
        assert_eq!(summary.payment_status, "paid");
        assert_eq!(summary.balance_due, 0.0);
    }

    #[test]
    fn validate_payment_amount_rejects_non_positive_and_overpay() {
        assert!(validate_payment_amount(0.0, 200.0, 0.0, 0.0).is_err());
        assert!(validate_payment_amount(-5.0, 200.0, 0.0, 0.0).is_err());
        assert!(validate_payment_amount(121.0, 200.0, 0.0, 80.0).is_err());
        assert!(validate_payment_amount(120.0, 200.0, 0.0, 80.0).is_ok());
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
            "giftCardRedemptions": [{ "code": "GC-1", "amount": 100.0 }],
        }));
        assert!(validate(&invoice).is_ok());
    }

    #[test]
    fn rejects_upfront_payments_covering_more_than_the_total() {
        let mut input = invoice(0.0, "amount", vec![customer(vec![order(100.0)])]);
        input.payments =
            serde_json::from_value(serde_json::json!([{ "amount": 150.0, "paymentType": "cash" }]))
                .unwrap();
        let error = validate(&input).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn accepts_upfront_payments_within_the_total() {
        let mut input = invoice(0.0, "amount", vec![customer(vec![order(100.0)])]);
        input.payments = serde_json::from_value(serde_json::json!([
            { "amount": 40.0, "paymentType": "cash" },
            { "amount": 60.0, "paymentType": "card" },
        ]))
        .unwrap();
        assert!(validate(&input).is_ok());
    }

    fn measurement_id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    #[test]
    fn measurement_reuse_picks_the_first_exclusive_row() {
        let old = vec![measurement_id(1), measurement_id(2)];
        let exclusive: HashSet<Uuid> = [measurement_id(1), measurement_id(2)].into();
        assert_eq!(
            plan_measurement_reuse(&old, &exclusive, &HashSet::new()),
            Some(measurement_id(1))
        );
    }

    #[test]
    fn measurement_reuse_leaves_shared_rows_alone() {
        // Every old row is also referenced by another invoice: nothing may be
        // rewritten, so the block falls back to the create rule instead.
        let old = vec![measurement_id(1)];
        assert_eq!(
            plan_measurement_reuse(&old, &HashSet::new(), &HashSet::new()),
            None
        );
    }

    #[test]
    fn measurement_reuse_skips_rows_claimed_by_an_earlier_block() {
        // Two edited blocks for the same customer must not rewrite the same
        // row twice.
        let old = vec![measurement_id(1), measurement_id(2)];
        let exclusive: HashSet<Uuid> = [measurement_id(1), measurement_id(2)].into();
        let reused: HashSet<Uuid> = [measurement_id(1)].into();
        assert_eq!(
            plan_measurement_reuse(&old, &exclusive, &reused),
            Some(measurement_id(2))
        );
    }

    #[test]
    fn measurement_reuse_finds_nothing_when_everything_is_taken() {
        let old = vec![measurement_id(1)];
        let exclusive: HashSet<Uuid> = [measurement_id(1)].into();
        let reused: HashSet<Uuid> = [measurement_id(1)].into();
        assert_eq!(plan_measurement_reuse(&old, &exclusive, &reused), None);
    }
}

/// A measurement snapshot for a new customer block: reuse the latest row when
/// nothing changed, insert a fresh one otherwise.
///
/// An unknown existing_customer_id surfaces as a foreign-key violation on the
/// insert, which the AppError conversion maps to a 400.
async fn resolve_measurement_for_create(
    tx: &mut sqlx::PgTransaction<'_>,
    customer_id: Uuid,
    measurement: &CreateMeasurementInput,
) -> Result<Uuid, AppError> {
    let latest = customers_repository::latest_measurement(tx, customer_id).await?;
    match latest {
        Some((id, ref values)) if measurement_values_equal(values, measurement) => Ok(id),
        _ => Ok(customers_repository::insert_measurement(tx, customer_id, measurement).await?),
    }
}

async fn write_customer_orders(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    measurement_id: Uuid,
    orders: &[CreateOrderInput],
) -> Result<(), AppError> {
    for order in orders {
        // The decrement is guarded in SQL, so `false` means the
        // production location either never stocked this material or no
        // longer holds enough of it. Reading the name for the message
        // costs an extra query only on that path.
        let decremented = materials_repository::decrement_stock(
            tx,
            order.material_id,
            order.production_location_id,
            order.material_amount,
        )
        .await?;

        if !decremented {
            let name = materials_repository::material_name(tx, order.material_id)
                .await?
                .ok_or_else(|| {
                    AppError::BadRequest(format!("no material with id {}", order.material_id))
                })?;

            return Err(AppError::BadRequest(format!(
                "not enough {name} in stock at the selected location"
            )));
        }

        repository::insert_order(tx, invoice_id, measurement_id, order).await?;
    }

    Ok(())
}

async fn write_product_lines(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    products: &[CreateProductLineInput],
) -> Result<(), AppError> {
    for line in products {
        // The decrement is guarded in SQL, so `None` means the location either
        // never stocked this product or no longer holds enough of it. Reading
        // the name for the message costs an extra query only on that path.
        let description = products_repository::decrement_stock(
            tx,
            line.product_id,
            line.branch_id,
            line.quantity,
        )
        .await?;

        let Some(description) = description else {
            let name = products_repository::product_name(tx, line.product_id)
                .await?
                .ok_or_else(|| {
                    AppError::BadRequest(format!("no product with id {}", line.product_id))
                })?;

            return Err(AppError::BadRequest(format!(
                "not enough {name} in stock at the selected location"
            )));
        };

        repository::insert_product_item(
            tx,
            invoice_id,
            line,
            &description,
            product_line_total(line),
        )
        .await?;
    }

    Ok(())
}

async fn write_gift_card_sales(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    customer_id: Option<Uuid>,
    gift_cards: &[CreateGiftCardLineInput],
) -> Result<(), AppError> {
    for card in gift_cards {
        let code = gift_cards_service::normalize_code(&card.code)?;

        let gift_card_id = gift_cards_repository::insert_gift_card(
            tx,
            &code,
            card.amount,
            // The card belongs to whoever the invoice is billed to, when the
            // sale names someone at all.
            customer_id,
            card.expires_on,
        )
        .await?;

        repository::insert_gift_card_item(
            tx,
            invoice_id,
            gift_card_id,
            &format!("Gift card {code}"),
            card.amount,
        )
        .await?;
    }

    Ok(())
}

async fn write_redemptions(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    date: NaiveDate,
    redemptions: &[GiftCardRedemptionInput],
) -> Result<(), AppError> {
    for redemption in redemptions {
        let code = gift_cards_service::normalize_code(&redemption.code)?;
        let gift_card_id = gift_cards_service::redeem(tx, &code, redemption.amount, date).await?;

        gift_cards_repository::insert_redemption(tx, gift_card_id, invoice_id, redemption.amount)
            .await?;
    }

    Ok(())
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

    for payment in &input.payments {
        repository::insert_payment(
            &mut tx,
            invoice_id,
            None,
            payment.amount,
            Some(payment.payment_type.as_str()),
        )
        .await?;
    }

    for customer in &input.customers {
        let customer_id = resolve_customer_id(&mut tx, customer).await?;
        let measurement_id =
            resolve_measurement_for_create(&mut tx, customer_id, &customer.measurement).await?;
        write_customer_orders(&mut tx, invoice_id, measurement_id, &customer.orders).await?;
    }

    write_product_lines(&mut tx, invoice_id, &input.products).await?;

    write_gift_card_sales(&mut tx, invoice_id, input.customer_id, &input.gift_cards).await?;

    write_redemptions(
        &mut tx,
        invoice_id,
        input.date,
        &input.gift_card_redemptions,
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        invoice_id = %invoice_id,
        total = totals.total,
        gift_card_redeemed = totals.redeemed,
        customers = input.customers.len(),
        product_lines = input.products.len(),
        gift_cards_sold = input.gift_cards.len(),
        gift_cards_redeemed = input.gift_card_redemptions.len(),
        "invoice created"
    );

    Ok(CreatedInvoice {
        id: invoice_id,
        total_price: totals.total,
        gift_card_redeemed: totals.redeemed,
    })
}

/// Reads one invoice as the values it was entered with, for the edit form.
pub async fn get_invoice_for_edit(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<InvoiceEdit, AppError> {
    repository::fetch_invoice_edit(state, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))
}

/// Picks the old measurement row an edited customer block rewrites in place:
/// the first of its rows that belongs to this invoice alone and hasn't already
/// been claimed by an earlier block. A block whose rows are all shared (or
/// that has no rows yet) gets `None` and falls back to the create rule, so a
/// shared row is never mutated. Pure, so it can be tested without a database.
fn plan_measurement_reuse(
    old_ids: &[Uuid],
    exclusive: &HashSet<Uuid>,
    reused: &HashSet<Uuid>,
) -> Option<Uuid> {
    old_ids
        .iter()
        .find(|id| exclusive.contains(id) && !reused.contains(id))
        .copied()
}

/// Rebuilds an invoice from a fresh copy of the create input: the old lines
/// are torn down (stock restored, tender paid back, sold cards deleted) and
/// the new lines go through the same writers as creation.
///
/// Refused once money or work has moved past the draft stage — a paid invoice,
/// a collected order, or any recorded stage/assignee/repair — since there is
/// no longer an untouched sale to rebuild.
pub async fn update_invoice(
    state: &AppState,
    invoice_id: Uuid,
    input: CreateInvoiceInput,
) -> Result<CreatedInvoice, AppError> {
    validate(&input)?;

    let totals = compute_totals(&input);

    let mut tx = state.db().begin().await?;

    repository::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;

    // Refused once money has moved: unlike the old header overwrite, the
    // ledger keeps every payment, so a rebuild can no longer silently reset
    // what was already taken.
    if repository::invoice_has_payments(&mut tx, invoice_id).await? {
        return Err(AppError::BadRequest(
            "this invoice has payments and cannot be edited".to_string(),
        ));
    }

    if repository::invoice_has_received_orders(&mut tx, invoice_id).await? {
        return Err(AppError::BadRequest(
            "this invoice has received orders and cannot be edited".to_string(),
        ));
    }

    if repository::invoice_has_production_activity(&mut tx, invoice_id).await? {
        return Err(AppError::BadRequest(
            "this invoice has production activity and cannot be edited".to_string(),
        ));
    }

    // Everything the rebuild is about to tear down.
    let order_lines = repository::old_order_lines(&mut tx, invoice_id).await?;
    let product_lines = repository::old_product_lines(&mut tx, invoice_id).await?;
    let gift_sales = repository::old_gift_card_sales(&mut tx, invoice_id).await?;
    let redemptions = repository::old_redemptions(&mut tx, invoice_id).await?;
    let measurement_refs = repository::old_measurement_refs(&mut tx, invoice_id).await?;

    // Gift cards first: lock every card this invoice touched so a till
    // redemption can't land between the spent-check and the reversal, then
    // refuse the edit if a card this invoice sold has been spent anywhere —
    // a spent card belongs to two invoices' histories and can neither be
    // deleted nor re-issued.
    let mut card_ids: Vec<Uuid> = gift_sales.iter().map(|sale| sale.gift_card_id).collect();
    card_ids.extend(redemptions.iter().map(|redemption| redemption.gift_card_id));
    card_ids.sort();
    card_ids.dedup();
    if !card_ids.is_empty() {
        repository::lock_gift_cards(&mut tx, &card_ids).await?;
    }
    for sale in &gift_sales {
        if repository::sold_card_was_used(&mut tx, sale.gift_card_id).await? {
            return Err(AppError::BadRequest(format!(
                "gift card {} has already been used and the invoice cannot be edited",
                sale.code
            )));
        }
    }
    for redemption in &redemptions {
        repository::refund_gift_card(&mut tx, redemption.gift_card_id, redemption.amount).await?;
    }

    // Hand back what the old lines consumed. The locations are nullable in the
    // schema for legacy rows; a missing one has no stock row to restore to, so
    // it is skipped rather than failing the edit.
    for line in &order_lines {
        if let Some(branch_id) = line.production_branch_id {
            repository::restore_material_stock(
                &mut tx,
                line.material_id,
                branch_id,
                line.material_amount,
            )
            .await?;
        }
    }
    for line in &product_lines {
        if let (Some(product_id), Some(branch_id)) = (line.product_id, line.branch_id) {
            repository::restore_product_stock(&mut tx, product_id, branch_id, line.quantity)
                .await?;
        }
    }

    // Tear down the old lines. Orders go before measurements (the FK points
    // from orders at measurements), and the sold gift cards go once the
    // spent-check above has cleared them.
    repository::delete_redemptions(&mut tx, invoice_id).await?;
    repository::delete_orders(&mut tx, invoice_id).await?;
    repository::delete_items(&mut tx, invoice_id).await?;
    let sold_ids: Vec<Uuid> = gift_sales.iter().map(|sale| sale.gift_card_id).collect();
    if !sold_ids.is_empty() {
        repository::delete_gift_cards(&mut tx, &sold_ids).await?;
    }

    // Which measurement rows belong to this invoice alone. The old rows are
    // grouped per customer the way the form's blocks were entered.
    let mut old_by_customer: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for reference in &measurement_refs {
        old_by_customer
            .entry(reference.customer_id)
            .or_default()
            .push(reference.measurement_id);
    }
    let mut exclusive = HashSet::new();
    for reference in &measurement_refs {
        if repository::measurement_is_exclusive(&mut tx, reference.measurement_id, invoice_id)
            .await?
        {
            exclusive.insert(reference.measurement_id);
        }
    }

    let mut reused: HashSet<Uuid> = HashSet::new();
    for customer in &input.customers {
        let customer_id = resolve_customer_id(&mut tx, customer).await?;
        let old_ids = old_by_customer
            .get(&customer_id)
            .cloned()
            .unwrap_or_default();

        let measurement_id = match plan_measurement_reuse(&old_ids, &exclusive, &reused) {
            Some(id) => {
                repository::update_measurement(&mut tx, id, &customer.measurement).await?;
                reused.insert(id);
                id
            }
            // No exclusive row to rewrite: shared rows stay untouched, and a
            // block without history falls back to the create rule.
            None => {
                resolve_measurement_for_create(&mut tx, customer_id, &customer.measurement).await?
            }
        };

        write_customer_orders(&mut tx, invoice_id, measurement_id, &customer.orders).await?;
    }

    // Old rows this invoice owned alone that no edited block rewrote — removed
    // blocks, or superseded extras — are deleted rather than left orphaned.
    // Shared rows are never touched: some other invoice still points at them.
    let mut orphaned: Vec<Uuid> = measurement_refs
        .iter()
        .map(|reference| reference.measurement_id)
        .filter(|id| exclusive.contains(id) && !reused.contains(id))
        .collect();
    orphaned.sort();
    orphaned.dedup();
    if !orphaned.is_empty() {
        repository::delete_measurements(&mut tx, &orphaned).await?;
    }

    write_product_lines(&mut tx, invoice_id, &input.products).await?;

    write_gift_card_sales(&mut tx, invoice_id, input.customer_id, &input.gift_cards).await?;

    write_redemptions(
        &mut tx,
        invoice_id,
        input.date,
        &input.gift_card_redemptions,
    )
    .await?;

    for payment in &input.payments {
        repository::insert_payment(
            &mut tx,
            invoice_id,
            None,
            payment.amount,
            Some(payment.payment_type.as_str()),
        )
        .await?;
    }

    repository::update_invoice_header(&mut tx, invoice_id, &input, totals.total, totals.redeemed)
        .await?;

    tx.commit().await?;

    tracing::info!(
        invoice_id = %invoice_id,
        total = totals.total,
        gift_card_redeemed = totals.redeemed,
        customers = input.customers.len(),
        product_lines = input.products.len(),
        gift_cards_sold = input.gift_cards.len(),
        gift_cards_redeemed = input.gift_card_redemptions.len(),
        "invoice updated"
    );

    Ok(CreatedInvoice {
        id: invoice_id,
        total_price: totals.total,
        gift_card_redeemed: totals.redeemed,
    })
}
