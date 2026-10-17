use std::collections::HashSet;

use uuid::Uuid;

use crate::{
    error::AppError,
    features::{
        invoices::repository as invoices,
        products::{repository as products, types::StockEntryInput},
    },
    state::AppState,
};

use super::{repository, types::*};

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

/// Allocate the discounted taxable gross in a stable line-id order, using
/// cumulative integer cents so the final line gets any rounding remainder.
/// Gift card sales are deliberately absent: spent stored value cannot be
/// returned as merchandise. The original taxable lines never change after a
/// return, which keeps this allocation stable across partial returns.
fn allocate_credits(lines: &mut [ReturnableLine], taxable_gross: f64) {
    let subtotal: i64 = lines.iter().map(|line| cents(line.line_total)).sum();
    if subtotal <= 0 {
        return;
    }
    let gross = i128::from(cents(taxable_gross).clamp(0, subtotal));
    let mut cumulative = 0i128;
    let mut allocated = 0i128;
    for line in lines {
        cumulative += i128::from(cents(line.line_total));
        let target = (cumulative * gross + i128::from(subtotal / 2)) / i128::from(subtotal);
        line.credit_limit = (target - allocated) as f64 / 100.0;
        allocated = target;
    }
}

/// Cumulative rounding makes three partial returns of a three-unit line
/// credit exactly the same amount as one full return.
fn line_credit(line: &ReturnableLine, input: &ReturnLineInput) -> Result<f64, AppError> {
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
    previous: Option<(Uuid, serde_json::Value)>,
    payload: &serde_json::Value,
) -> Result<Option<RecordedAdjustment>, AppError> {
    match previous {
        Some((id, original)) if original == *payload => Ok(Some(RecordedAdjustment { id })),
        Some(_) => Err(AppError::Conflict(
            "this requestId was already used with different values".to_string(),
        )),
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
    let result = ReturnContext {
        settlement: repository::settlement(&mut tx, invoice_id).await?,
        lines: load_lines(&mut tx, invoice_id).await?,
        returns: repository::history(&mut tx, invoice_id).await?,
        refunds: repository::refunds(&mut tx, invoice_id).await?,
        gift_cards: repository::refundable_cards(&mut tx, invoice_id).await?,
    };
    tx.commit().await?;
    Ok(result)
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
    let payload = serde_json::to_value(&input).expect("serializable return input");
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    if let Some(result) = replay(
        repository::previous_request(&mut tx, invoice_id, input.request_id, true).await?,
        &payload,
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
    let id = repository::insert_return(&mut tx, invoice_id, &input, payload, total, actor).await?;
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
    let payload = serde_json::to_value(&input).expect("serializable refund input");
    let mut tx = state.db().begin().await?;
    invoices::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    if let Some(result) = replay(
        repository::previous_request(&mut tx, invoice_id, input.request_id, false).await?,
        &payload,
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
    let id = repository::insert_refund(&mut tx, invoice_id, &input, payload, actor).await?;
    if let Some(card_id) = input.gift_card_id {
        // Atomic increment locks the card, so concurrent spending/returns on
        // other invoices cannot lose a restored balance.
        invoices::refund_gift_card(&mut tx, card_id, input.amount).await?;
    }
    tx.commit().await?;
    tracing::info!(%invoice_id, refund_id = %id, amount = input.amount, actor, "refund recorded");
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
            collected: true,
            can_restock: true,
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
    fn idempotency_replays_only_the_original_payload() {
        let id = Uuid::new_v4();
        let payload = json!({"amount":10});
        assert_eq!(
            replay(Some((id, payload.clone())), &payload)
                .unwrap()
                .unwrap()
                .id,
            id
        );
        assert!(replay(Some((id, payload)), &json!({"amount":20})).is_err());
    }
}
