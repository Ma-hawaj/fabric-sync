use chrono::NaiveDate;
use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{CreateGiftCardInput, GiftCard, GiftCardBalance, UpdateGiftCardInput},
};

/// Codes are matched exactly on redemption, so they are uppercased on the way
/// in — staff read them off a physical card and the case they type is not
/// meaningful. `pub` because invoices normalizes the same way before selling or
/// redeeming a card.
pub fn normalize_code(code: &str) -> Result<String, AppError> {
    let code = code.trim();

    if code.is_empty() {
        return Err(AppError::BadRequest(
            "gift card code cannot be empty".to_string(),
        ));
    }

    Ok(code.to_uppercase())
}

pub fn validate_amount(amount: f64) -> Result<(), AppError> {
    if amount <= 0.0 {
        return Err(AppError::BadRequest(
            "a gift card amount must be greater than zero".to_string(),
        ));
    }

    Ok(())
}

/// The redemption policy, kept separate from the SQL so it can be tested
/// without a database. `on` is the invoice date rather than today's date, so
/// back-dating an invoice checks expiry against the date of the sale.
fn check_redeemable(
    card: &GiftCardBalance,
    code: &str,
    amount: f64,
    on: NaiveDate,
) -> Result<(), AppError> {
    if !card.is_active {
        return Err(AppError::BadRequest(format!("gift card {code} is voided")));
    }

    if card.expires_on.is_some_and(|expires_on| expires_on < on) {
        return Err(AppError::BadRequest(format!(
            "gift card {code} has expired"
        )));
    }

    if card.balance < amount {
        return Err(AppError::BadRequest(format!(
            "gift card {code} only has {:.2} left",
            card.balance
        )));
    }

    Ok(())
}

pub async fn list_gift_cards(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<GiftCard>, AppError> {
    repository::list_gift_cards(state, params).await
}

/// Resolves the code staff typed at the till. The code is normalized the same
/// way it was on the way in, so the case they type does not matter.
pub async fn get_gift_card_by_code(state: &AppState, code: &str) -> Result<GiftCard, AppError> {
    let code = normalize_code(code)?;

    repository::get_gift_card_by_code(state, &code)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no gift card with code {code}")))
}

pub async fn create_gift_card(
    state: &AppState,
    input: CreateGiftCardInput,
) -> Result<GiftCard, AppError> {
    let code = normalize_code(&input.code)?;
    validate_amount(input.amount)?;

    let mut tx = state.db().begin().await?;

    let gift_card_id = repository::insert_gift_card(
        &mut tx,
        &code,
        input.amount,
        input.customer_id,
        input.expires_on,
    )
    .await?;

    tx.commit().await?;

    tracing::info!(
        gift_card_id = %gift_card_id,
        code = %code,
        amount = input.amount,
        "gift card created"
    );

    Ok(repository::get_gift_card(state, gift_card_id)
        .await?
        .expect("gift card was just created"))
}

pub async fn update_gift_card(
    state: &AppState,
    gift_card_id: Uuid,
    input: UpdateGiftCardInput,
) -> Result<GiftCard, AppError> {
    repository::update_gift_card(state, gift_card_id, input.is_active)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("gift card {gift_card_id} not found")))?;

    tracing::info!(
        gift_card_id = %gift_card_id,
        is_active = ?input.is_active,
        "gift card updated"
    );

    Ok(repository::get_gift_card(state, gift_card_id)
        .await?
        .expect("gift card was just updated"))
}

/// Spends `amount` off the card with this code and returns its id, so the
/// caller can record the redemption against an invoice. Tx-scoped: invoices
/// calls this inside its own transaction, and a later failure rolls the balance
/// back with everything else.
pub async fn redeem(
    tx: &mut sqlx::PgTransaction<'_>,
    code: &str,
    amount: f64,
    on: NaiveDate,
) -> Result<Uuid, AppError> {
    let card = repository::lock_by_code(tx, code)
        .await?
        .ok_or_else(|| AppError::BadRequest(format!("no gift card with code {code}")))?;

    check_redeemable(&card, code, amount, on)?;

    repository::decrement_balance(tx, card.id, amount).await?;

    tracing::info!(gift_card_id = %card.id, code = %code, amount, "gift card redeemed");

    Ok(card.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> NaiveDate {
        text.parse().unwrap()
    }

    fn card(balance: f64) -> GiftCardBalance {
        GiftCardBalance {
            id: Uuid::nil(),
            balance,
            is_active: true,
            expires_on: None,
        }
    }

    #[test]
    fn normalize_code_trims_and_uppercases() {
        assert_eq!(normalize_code("  gc-abc123 \n").unwrap(), "GC-ABC123");
    }

    #[test]
    fn normalize_code_rejects_blank_codes() {
        for code in ["", "   ", "\t\n"] {
            let error = normalize_code(code).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{code:?}");
        }
    }

    #[test]
    fn validate_amount_rejects_zero_and_negative_amounts() {
        assert!(validate_amount(100.0).is_ok());
        for amount in [0.0, -50.0] {
            let error = validate_amount(amount).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{amount}");
        }
    }

    #[test]
    fn a_card_can_be_spent_down_to_exactly_zero() {
        assert!(check_redeemable(&card(100.0), "GC-1", 100.0, date("2026-07-19")).is_ok());
    }

    #[test]
    fn redeeming_more_than_the_balance_is_rejected() {
        let error = check_redeemable(&card(40.0), "GC-1", 40.01, date("2026-07-19")).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn a_voided_card_cannot_be_redeemed() {
        let voided = GiftCardBalance {
            is_active: false,
            ..card(100.0)
        };
        let error = check_redeemable(&voided, "GC-1", 10.0, date("2026-07-19")).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn a_card_is_still_redeemable_on_its_expiry_date() {
        let expiring = GiftCardBalance {
            expires_on: Some(date("2026-07-19")),
            ..card(100.0)
        };
        assert!(check_redeemable(&expiring, "GC-1", 10.0, date("2026-07-19")).is_ok());
    }

    #[test]
    fn a_card_cannot_be_redeemed_the_day_after_it_expires() {
        let expired = GiftCardBalance {
            expires_on: Some(date("2026-07-19")),
            ..card(100.0)
        };
        let error = check_redeemable(&expired, "GC-1", 10.0, date("2026-07-20")).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }
}
