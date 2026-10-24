use std::collections::HashSet;

use uuid::Uuid;

use crate::{
    error::AppError,
    features::{
        invoices::repository as invoices,
        materials::{repository as materials, types::StockEntryInput as MaterialStockInput},
        orders::repository as orders,
        products::{repository as products, types::StockEntryInput},
    },
    state::AppState,
};

use super::{repository, types::*};
use crate::idempotency::{request_hash, verify_request_hash};

fn bad_request(message: &str) -> AppError {
    AppError::BadRequest(message.to_string())
}

fn cents(value: f64) -> i64 {
    (value * 100.0).round() as i64
}

fn valid_quantity(value: f64) -> bool {
    value.is_finite()
        && value > 0.0
        && value <= 99_999_999.99
        && (value * 100.0 - (value * 100.0).round()).abs() < 1e-6
}

fn validate_reason(reason: &str) -> Result<(), AppError> {
    if reason.trim().is_empty() || reason.trim().chars().count() > 1000 {
        return Err(bad_request("enter a reason of 1 to 1000 characters"));
    }
    Ok(())
}

/// Allocate the discounted merchandise gross in a stable line-id order, using
/// cumulative integer cents so the final line gets any rounding remainder.
/// Add each garment's original urgency fee after that allocation, without
/// discounting the fee or attributing it to another line.
/// Gift card sales are deliberately absent: spent stored value cannot be
/// returned as merchandise. The original taxable lines never change after a
/// return, which keeps this allocation stable across partial returns.
fn allocate_credits(lines: &mut [ReturnableLine], taxable_gross: f64) {
    let subtotal: i64 = lines.iter().map(|line| cents(line.line_total)).sum();
    if subtotal <= 0 {
        for line in lines {
            line.credit_limit = line.urgent_charge;
        }
        return;
    }
    let gross = i128::from(cents(taxable_gross).clamp(0, subtotal));
    let mut cumulative = 0i128;
    let mut allocated = 0i128;
    for line in lines {
        cumulative += i128::from(cents(line.line_total));
        let target = (cumulative * gross + i128::from(subtotal / 2)) / i128::from(subtotal);
        line.credit_limit =
            ((target - allocated) as i64 + cents(line.urgent_charge)) as f64 / 100.0;
        allocated = target;
    }
}

/// Cumulative rounding makes three partial returns of a three-unit line
/// credit exactly the same amount as one full return.
fn line_credit(line: &ReturnableLine, input: &ReturnLineInput) -> Result<f64, AppError> {
    validate_active(&line.outcome)?;
    if !valid_quantity(input.quantity) {
        return Err(bad_request(
            "return quantity must be positive with at most two decimal places",
        ));
    }
    let returned = cents(line.returned_quantity) + cents(input.quantity);
    let sold = cents(line.quantity);
    if returned > sold {
        return Err(bad_request(
            "return quantity exceeds the quantity still eligible on this line",
        ));
    }
    if !line.collected {
        return Err(bad_request(
            "a tailoring order must be collected before it can be returned",
        ));
    }
    if line.kind == "order" && cents(input.quantity) != 100 {
        return Err(bad_request("return a tailoring garment as one whole item"));
    }
    if input.restock && !line.can_restock {
        return Err(bad_request(
            "only retail products at an active stock location can be restocked",
        ));
    }
    let target = (i128::from(cents(line.credit_limit)) * i128::from(returned)
        + i128::from(sold / 2))
        / i128::from(sold);
    Ok((target as i64 - cents(line.credited_amount)) as f64 / 100.0)
}

fn validate_active(outcome: &str) -> Result<(), AppError> {
    if outcome != "active" {
        return Err(bad_request(
            "this order is closed by a cancellation or return",
        ));
    }
    Ok(())
}

pub(crate) async fn ensure_order_active(
    tx: &mut sqlx::PgTransaction<'_>,
    order_id: Uuid,
) -> Result<(), AppError> {
    let outcome = repository::order_outcome(tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    validate_active(&outcome)
}

fn validate_refund(amount: f64, due: f64, tender_available: f64) -> Result<(), AppError> {
    if !valid_quantity(amount) {
        return Err(bad_request(
            "refund amount must be positive with at most two decimal places",
        ));
    }
    if cents(amount) > cents(due) {
        return Err(bad_request(
            "refund exceeds the customer credit available on this invoice",
        ));
    }
    if cents(amount) > cents(tender_available) {
        return Err(bad_request(
            "refund exceeds the amount remaining in this payment channel",
        ));
    }
    Ok(())
}

fn replay(
    previous: Option<(Uuid, Vec<u8>)>,
    hash: &[u8],
) -> Result<Option<RecordedAdjustment>, AppError> {
    match previous {
        Some((id, original)) => {
            verify_request_hash(&original, hash)?;
            Ok(Some(RecordedAdjustment { id }))
        }
        None => Ok(None),
    }
}

async fn load_lines(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<ReturnableLine>, AppError> {
    let mut lines = repository::returnable_lines(tx, invoice_id).await?;
    let taxable_gross = repository::returnable_total(tx, invoice_id).await?;
    allocate_credits(&mut lines, taxable_gross);
    Ok(lines)
}

pub async fn context(state: &AppState, invoice_id: Uuid) -> Result<ReturnContext, AppError> {
    let mut tx = state.db().begin().await?;
    // The same lock as writes makes all the balances and histories in this
    // response agree, including when a return and refund happen concurrently.
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    let result = load_context(&mut tx, invoice_id).await?;
    tx.commit().await?;
    Ok(result)
}

async fn load_context(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<ReturnContext, AppError> {
    Ok(ReturnContext {
        settlement: repository::settlement(tx, invoice_id).await?,
        lines: load_lines(tx, invoice_id).await?,
        returns: repository::history(tx, invoice_id).await?,
        refunds: repository::refunds(tx, invoice_id).await?,
        gift_cards: repository::refundable_cards(tx, invoice_id).await?,
    })
}

pub async fn create_return(
    state: &AppState,
    invoice_id: Uuid,
    input: CreateReturnInput,
    actor: &str,
) -> Result<RecordedAdjustment, AppError> {
    validate_reason(&input.reason)?;
    if input.lines.is_empty() || input.lines.len() > 200 {
        return Err(bad_request("select between 1 and 200 lines to return"));
    }
    let hash = request_hash("invoice.return.v1", invoice_id, &input);
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    if let Some(result) = replay(
        repository::previous_request(&mut tx, invoice_id, input.request_id, true).await?,
        &hash,
    )? {
        return Ok(result);
    }
    let lines = load_lines(&mut tx, invoice_id).await?;
    let mut seen = HashSet::new();
    let mut planned = Vec::new();
    for item in &input.lines {
        if !seen.insert(item.line_id) {
            return Err(bad_request("a return cannot contain the same line twice"));
        }
        let line = lines
            .iter()
            .find(|line| line.line_id == item.line_id)
            .ok_or_else(|| {
                bad_request("this line is not returnable merchandise on this invoice")
            })?;
        let amount = line_credit(line, item)?;
        planned.push((line, item, amount));
    }
    let total = planned
        .iter()
        .map(|(_, _, amount)| cents(*amount))
        .sum::<i64>() as f64
        / 100.0;
    let id = repository::insert_return(&mut tx, invoice_id, &input, &hash, total, actor).await?;
    for (line, item, amount) in planned {
        repository::insert_line(&mut tx, id, line, item, amount).await?;
        if item.restock {
            // The original sale location is used; cut tailoring fabric is
            // never replenished as a side effect of returning a garment.
            products::upsert_stock(
                &mut tx,
                line.product_id.expect("retail product"),
                &[StockEntryInput {
                    location_id: line.branch_id.expect("validated stock location"),
                    quantity: item.quantity,
                }],
            )
            .await?;
        }
    }
    apply_refund_plan(&mut tx, invoice_id, id, &input.reason, &input.refund, actor).await?;
    tx.commit().await?;
    tracing::info!(%invoice_id, return_id = %id, amount = total, actor, "return recorded");
    Ok(RecordedAdjustment { id })
}

pub async fn create_refund(
    state: &AppState,
    invoice_id: Uuid,
    input: CreateRefundInput,
    actor: &str,
) -> Result<RecordedAdjustment, AppError> {
    validate_reason(&input.reason)?;
    if matches!(input.payment_type, RefundMethod::GiftCard) != input.gift_card_id.is_some() {
        return Err(bad_request(
            "select an original redeemed gift card only for a gift card refund",
        ));
    }
    let hash = request_hash("invoice.refund.v1", invoice_id, &input);
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    if let Some(result) = replay(
        repository::previous_request(&mut tx, invoice_id, input.request_id, false).await?,
        &hash,
    )? {
        return Ok(result);
    }
    let balance = repository::settlement(&mut tx, invoice_id).await?;
    let available = if let Some(card_id) = input.gift_card_id {
        repository::refundable_cards(&mut tx, invoice_id)
            .await?
            .into_iter()
            .find(|card| card.id == card_id)
            .ok_or_else(|| bad_request("this gift card was not redeemed on this invoice"))?
            .refundable_amount
    } else {
        balance.net_amount_paid
    };
    validate_refund(input.amount, balance.refund_due, available)?;
    let id = repository::insert_refund(&mut tx, invoice_id, &input, &hash, actor, None).await?;
    if let Some(card_id) = input.gift_card_id {
        // Atomic increment locks the card, so concurrent spending/returns on
        // other invoices cannot lose a restored balance.
        invoices::refund_gift_card(&mut tx, card_id, input.amount).await?;
    }
    tx.commit().await?;
    tracing::info!(%invoice_id, refund_id = %id, amount = input.amount, actor, "refund recorded");
    Ok(RecordedAdjustment { id })
}

/// Refund exactly the credit owed after this adjustment, or explicitly leave
/// it pending. All tender caps are checked against the ledger after each row,
/// including the shared external-payment cap across Cash, Benefit and Card.
async fn apply_refund_plan(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    adjustment_id: Uuid,
    reason: &str,
    plan: &RefundPlan,
    actor: &str,
) -> Result<(), AppError> {
    let RefundPlan::Now { payments } = plan else {
        return Ok(());
    };
    let balance = repository::settlement(tx, invoice_id).await?;
    validate_refund_total(payments, balance.refund_due)?;
    for tender in payments {
        if matches!(tender.payment_type, RefundMethod::GiftCard) != tender.gift_card_id.is_some() {
            return Err(bad_request(
                "gift card refunds must name an original redeemed card",
            ));
        }
        let current = repository::settlement(tx, invoice_id).await?;
        let available = if let Some(card_id) = tender.gift_card_id {
            repository::refundable_cards(tx, invoice_id)
                .await?
                .into_iter()
                .find(|card| card.id == card_id)
                .ok_or_else(|| bad_request("this gift card was not redeemed on this invoice"))?
                .refundable_amount
        } else {
            current.net_amount_paid
        };
        validate_refund(tender.amount, current.refund_due, available)?;
        let input = CreateRefundInput {
            request_id: Uuid::new_v4(),
            reason: reason.trim().to_string(),
            amount: tender.amount,
            payment_type: tender.payment_type.clone(),
            gift_card_id: tender.gift_card_id,
        };
        let hash = request_hash("invoice.refund.v1", invoice_id, &input);
        repository::insert_refund(tx, invoice_id, &input, &hash, actor, Some(adjustment_id))
            .await?;
        if let Some(card_id) = tender.gift_card_id {
            invoices::refund_gift_card(tx, card_id, tender.amount).await?;
        }
    }
    Ok(())
}

fn validate_refund_total(payments: &[RefundTender], due: f64) -> Result<(), AppError> {
    if payments.len() > 200 || payments.iter().any(|p| !valid_quantity(p.amount)) {
        return Err(bad_request(
            "refund payments must be positive amounts with at most two decimal places",
        ));
    }
    if payments.iter().map(|p| cents(p.amount)).sum::<i64>() != cents(due) {
        return Err(bad_request(
            "refund payments must cover the refund due exactly, or choose refund later",
        ));
    }
    Ok(())
}

fn cancellation_credit(
    details: &CancellationDetails,
    limit: f64,
    input: &CreateCancellationInput,
) -> Result<f64, AppError> {
    validate_active(&details.outcome)?;
    if !matches!(details.status.as_str(), "pending" | "ready") {
        return Err(bad_request(
            "a collected order must be returned rather than cancelled",
        ));
    }
    for value in [input.retained_charge, input.restored_material_quantity] {
        if value != 0.0 && !valid_quantity(value) {
            return Err(bad_request(
                "charges and stock quantities must be nonnegative with at most two decimal places",
            ));
        }
    }
    if cents(input.retained_charge) > cents(limit) {
        return Err(bad_request(
            "the retained charge cannot exceed the order's discounted value",
        ));
    }
    if !details.production_started && input.retained_charge != 0.0 {
        return Err(bad_request(
            "cancellation before production starts receives full credit",
        ));
    }
    if details.production_started && !input.work_charge_confirmed {
        return Err(bad_request(
            "confirm that the retained work/material charge was agreed with the customer",
        ));
    }
    if input.restored_material_quantity > 0.0
        && (!details.can_restore_material
            || !input.unused_material_confirmed
            || cents(input.restored_material_quantity) > cents(details.material_amount))
    {
        return Err(bad_request(
            "restore only confirmed unused shop fabric to its recorded deduction location",
        ));
    }
    Ok((cents(limit) - cents(input.retained_charge)) as f64 / 100.0)
}

pub async fn cancellation_context(
    state: &AppState,
    order_id: Uuid,
) -> Result<CancellationContext, AppError> {
    let order = orders::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, order.invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {} not found", order.invoice_id)))?;
    let details = repository::cancellation_details(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let invoice = load_context(&mut tx, order.invoice_id).await?;
    tx.commit().await?;
    Ok(CancellationContext {
        order: details,
        invoice,
    })
}

pub async fn cancel_order(
    state: &AppState,
    order_id: Uuid,
    input: CreateCancellationInput,
    actor: &str,
) -> Result<RecordedAdjustment, AppError> {
    validate_reason(&input.reason)?;
    let original = orders::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let invoice_id = original.invoice_id;
    let hash = request_hash("order.cancel.v1", order_id, &input);
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    if let Some(result) = replay(
        repository::previous_request(&mut tx, invoice_id, input.request_id, true).await?,
        &hash,
    )? {
        return Ok(result);
    }
    let details = repository::cancellation_details(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let lines = load_lines(&mut tx, invoice_id).await?;
    let line = lines
        .iter()
        .find(|line| line.line_id == order_id)
        .ok_or_else(|| bad_request("order line is missing from this invoice"))?;
    let credit = cancellation_credit(&details, line.credit_limit, &input)?;
    let was_ready = repository::readiness_status(&mut tx, invoice_id).await?;
    let id =
        repository::insert_cancellation(&mut tx, &details, &input, &hash, credit, actor).await?;
    repository::insert_line(
        &mut tx,
        id,
        line,
        &ReturnLineInput {
            line_id: order_id,
            quantity: 1.0,
            restock: false,
        },
        credit,
    )
    .await?;
    if input.restored_material_quantity > 0.0 {
        materials::upsert_stock(
            &mut tx,
            details.material_id.expect("validated shop material"),
            &[MaterialStockInput {
                location_id: details.stock_branch_id.expect("validated stock origin"),
                quantity: input.restored_material_quantity,
            }],
        )
        .await?;
    }
    apply_refund_plan(&mut tx, invoice_id, id, &input.reason, &input.refund, actor).await?;
    if was_ready != "ready" && repository::readiness_status(&mut tx, invoice_id).await? == "ready" {
        repository::advance_readiness_generation(&mut tx, invoice_id).await?;
    }
    tx.commit().await?;
    tracing::info!(%invoice_id, %order_id, adjustment_id = %id, credit, actor, "order cancelled");
    Ok(RecordedAdjustment { id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(total: f64, quantity: f64) -> ReturnableLine {
        ReturnableLine {
            line_id: Uuid::new_v4(),
            kind: "product".into(),
            description: "Product".into(),
            quantity,
            returned_quantity: 0.0,
            credited_amount: 0.0,
            line_total: total,
            urgent_charge: 0.0,
            collected: true,
            can_restock: true,
            outcome: "active".into(),
            credit_limit: total,
            product_id: None,
            branch_id: None,
        }
    }

    #[test]
    fn discounted_allocations_preserve_every_cent() {
        let mut lines = vec![line(10.0, 1.0), line(10.0, 1.0), line(10.0, 1.0)];
        allocate_credits(&mut lines, 20.0);
        assert_eq!(
            lines.iter().map(|l| cents(l.credit_limit)).sum::<i64>(),
            2000
        );
        assert_eq!(
            lines.iter().map(|l| l.credit_limit).collect::<Vec<_>>(),
            vec![6.67, 6.66, 6.67]
        );
        allocate_credits(&mut lines, 22.5);
        assert_eq!(
            lines.iter().map(|l| cents(l.credit_limit)).sum::<i64>(),
            2250
        );
        allocate_credits(&mut lines, 0.0);
        assert!(lines.iter().all(|l| l.credit_limit == 0.0));
    }

    #[test]
    fn repeated_partial_returns_equal_a_full_return() {
        let mut line = line(10.0, 3.0);
        let input = ReturnLineInput {
            line_id: line.line_id,
            quantity: 1.0,
            restock: true,
        };
        let mut credits = Vec::new();
        for _ in 0..3 {
            let credit = line_credit(&line, &input).unwrap();
            line.returned_quantity += 1.0;
            line.credited_amount += credit;
            credits.push(credit);
        }
        assert_eq!(credits, vec![3.33, 3.34, 3.33]);
        assert_eq!(cents(line.credited_amount), 1000);
        assert!(line_credit(&line, &input).is_err());
    }

    #[test]
    fn urgency_fees_stay_with_their_order_and_are_not_discounted() {
        let mut lines = vec![line(100.0, 1.0), line(100.0, 1.0)];
        lines[0].urgent_charge = 5.0;
        allocate_credits(&mut lines, 180.0);
        assert_eq!(lines[0].credit_limit, 95.0);
        assert_eq!(lines[1].credit_limit, 90.0);
        let mut zero_base = vec![line(0.0, 1.0)];
        zero_base[0].urgent_charge = 5.0;
        allocate_credits(&mut zero_base, 0.0);
        assert_eq!(zero_base[0].credit_limit, 5.0);
    }

    #[test]
    fn tailoring_returns_require_collection_and_never_restore_fabric() {
        let mut line = line(20.0, 1.0);
        line.kind = "order".into();
        line.can_restock = false;
        line.collected = false;
        let mut input = ReturnLineInput {
            line_id: line.line_id,
            quantity: 1.0,
            restock: false,
        };
        assert!(line_credit(&line, &input).is_err());
        line.collected = true;
        input.quantity = 0.5;
        assert!(line_credit(&line, &input).is_err());
        input.quantity = 1.0;
        input.restock = true;
        assert!(line_credit(&line, &input).is_err());
        input.restock = false;
        assert_eq!(line_credit(&line, &input).unwrap(), 20.0);
    }

    #[test]
    fn refund_caps_protect_unpaid_sales_and_gift_tender() {
        assert!(validate_refund(10.0, 0.0, 100.0).is_err());
        assert!(validate_refund(10.0, 20.0, 5.0).is_err());
        assert!(validate_refund(20.01, 20.0, 100.0).is_err());
        assert!(validate_refund(20.0, 20.0, 20.0).is_ok());
        for amount in [0.0, -1.0, 1.001, f64::NAN, f64::INFINITY] {
            assert!(validate_refund(amount, 100.0, 100.0).is_err());
        }
    }

    #[test]
    fn immediate_refund_requires_the_exact_total_in_valid_tenders() {
        let tender = |amount| RefundTender {
            amount,
            payment_type: RefundMethod::Cash,
            gift_card_id: None,
        };
        assert!(validate_refund_total(&[], 0.0).is_ok());
        assert!(validate_refund_total(&[], 10.0).is_err());
        assert!(validate_refund_total(&[tender(0.1), tender(0.2)], 0.3).is_ok());
        assert!(validate_refund_total(&[tender(9.99)], 10.0).is_err());
        assert!(validate_refund_total(&[tender(10.01)], 10.0).is_err());
        for amount in [0.0, -1.0, 0.001, f64::NAN, f64::INFINITY] {
            assert!(validate_refund_total(&[tender(amount)], 0.0).is_err());
        }
    }

    fn cancellation() -> (CancellationDetails, CreateCancellationInput) {
        (
            CancellationDetails {
                order_id: Uuid::new_v4(),
                invoice_id: Uuid::new_v4(),
                status: "pending".into(),
                outcome: "active".into(),
                production_started: false,
                material_source: "shop".into(),
                material_amount: 3.5,
                can_restore_material: true,
                stock_location: Some("Original stock branch".into()),
                material_id: Some(Uuid::new_v4()),
                stock_branch_id: Some(Uuid::new_v4()),
            },
            CreateCancellationInput {
                request_id: Uuid::new_v4(),
                reason: "Customer cancelled".into(),
                retained_charge: 0.0,
                restored_material_quantity: 0.0,
                work_charge_confirmed: false,
                unused_material_confirmed: false,
                refund: RefundPlan::default(),
            },
        )
    }

    #[test]
    fn unstarted_cancellation_gives_full_credit_and_never_assumes_unused_stock() {
        let (details, mut input) = cancellation();
        assert_eq!(cancellation_credit(&details, 90.0, &input).unwrap(), 90.0);
        input.retained_charge = 0.01;
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        input.retained_charge = 0.0;
        input.restored_material_quantity = 3.5;
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        input.unused_material_confirmed = true;
        assert!(cancellation_credit(&details, 90.0, &input).is_ok());
        input.restored_material_quantity = 3.51;
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
    }

    #[test]
    fn started_cancellation_requires_customer_agreement_and_caps_retained_charge() {
        let (mut details, mut input) = cancellation();
        details.production_started = true;
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        input.work_charge_confirmed = true;
        input.retained_charge = 25.25;
        assert_eq!(cancellation_credit(&details, 90.0, &input).unwrap(), 64.75);
        input.retained_charge = 90.0;
        assert_eq!(cancellation_credit(&details, 90.0, &input).unwrap(), 0.0);
        for charge in [90.01, -1.0, 1.001, f64::NAN, f64::INFINITY] {
            input.retained_charge = charge;
            assert!(cancellation_credit(&details, 90.0, &input).is_err());
        }
    }

    #[test]
    fn unknown_stock_origins_and_customer_fabric_cannot_be_restocked() {
        let (mut details, mut input) = cancellation();
        details.can_restore_material = false;
        input.unused_material_confirmed = true;
        input.restored_material_quantity = 1.0;
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        details.material_source = "customer".into();
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        input.restored_material_quantity = 0.0;
        assert!(cancellation_credit(&details, 90.0, &input).is_ok());
    }

    #[test]
    fn collected_and_closed_orders_cannot_be_cancelled_or_returned_again() {
        let (mut details, input) = cancellation();
        details.status = "collected".into();
        assert!(cancellation_credit(&details, 90.0, &input).is_err());
        details.status = "pending".into();
        for outcome in ["cancelled", "returned"] {
            details.outcome = outcome.into();
            assert!(cancellation_credit(&details, 90.0, &input).is_err());
            let mut closed_line = line(10.0, 1.0);
            closed_line.outcome = outcome.into();
            assert!(line_credit(
                &closed_line,
                &ReturnLineInput {
                    line_id: closed_line.line_id,
                    quantity: 1.0,
                    restock: false,
                }
            )
            .is_err());
        }
    }

    #[test]
    fn idempotency_replays_only_the_original_hash() {
        let id = Uuid::new_v4();
        let hash = request_hash("refund.v1", id, &json!({"amount":10}));
        assert_eq!(
            replay(Some((id, hash.to_vec())), &hash)
                .unwrap()
                .unwrap()
                .id,
            id
        );
        assert!(replay(Some((id, hash.to_vec())), &[0; 32]).is_err());
        assert!(replay(None, &hash).unwrap().is_none());
    }
}
