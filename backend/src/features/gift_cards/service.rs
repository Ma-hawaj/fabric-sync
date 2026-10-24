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

// A power-of-two alphabet avoids modulo bias and omits 0/O and 1/I.
const CODE_ALPHABET: &[u8; 32] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_ATTEMPTS: usize = 8;

/// Resolve staff input to the issued format before validation or lookup.
/// The prefix, separators, and letter case are optional.
pub fn normalize_code(code: &str) -> Result<String, AppError> {
    let compact: String = code
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect();
    let payload = if compact.len() == 14 && compact.starts_with("GC") {
        &compact[2..]
    } else {
        &compact
    };
    if payload.len() != 12 || !payload.bytes().all(|c| CODE_ALPHABET.contains(&c)) {
        return Err(AppError::BadRequest(
            "Enter the 12 characters shown on the gift card.".into(),
        ));
    }
    Ok(format!(
        "GC-{}-{}-{}",
        &payload[..4],
        &payload[4..8],
        &payload[8..]
    ))
}

pub fn validate_amount(amount: f64) -> Result<(), AppError> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err(AppError::BadRequest(
            "a gift card amount must be greater than zero".to_string(),
        ));
    }

    Ok(())
}

pub fn generate_code() -> String {
    // The low 60 bits of a random UUID contain no fixed version/variant bits.
    let random = Uuid::new_v4().as_u128();
    let mut code = String::with_capacity(17);
    code.push_str("GC-");
    for index in 0..12 {
        if index > 0 && index % 4 == 0 {
            code.push('-');
        }
        code.push(CODE_ALPHABET[((random >> ((11 - index) * 5)) & 31) as usize] as char);
    }
    code
}

pub async fn issue_gift_card(
    tx: &mut sqlx::PgTransaction<'_>,
    input: &CreateGiftCardInput,
    region: &str,
) -> Result<(Uuid, String), AppError> {
    issue_with_generator(tx, input, region, generate_code).await
}

pub(super) async fn issue_with_generator(
    tx: &mut sqlx::PgTransaction<'_>,
    input: &CreateGiftCardInput,
    region: &str,
    mut generate: impl FnMut() -> String,
) -> Result<(Uuid, String), AppError> {
    validate_amount(input.amount)?;
    let phone = recipient_phone(&input.recipient_phone, region)?;
    for _ in 0..CODE_ATTEMPTS {
        let code = generate();
        if let Some(id) = repository::try_insert_generated_gift_card(
            tx,
            &code,
            input.amount,
            input.customer_id,
            input.expires_on,
            input.bought_for.as_deref(),
            &phone,
        )
        .await?
        {
            return Ok((id, code));
        }
    }
    Err(AppError::Conflict(
        "Could not generate a unique gift card code. Please try again.".into(),
    ))
}

pub fn recipient_phone(raw: &str, region: &str) -> Result<String, AppError> {
    crate::features::notifications::phone::normalize(raw, region)
        .ok_or_else(|| AppError::BadRequest("Enter a valid recipient phone number.".into()))
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

/// Resolves the code staff typed at the till with a single canonical lookup.
pub async fn get_gift_card_by_code(state: &AppState, code: &str) -> Result<GiftCard, AppError> {
    // A malformed or incomplete entry is a normal lookup miss at the till.
    let code = normalize_code(code)
        .map_err(|_| AppError::NotFound("no gift card with this code".into()))?;
    repository::get_gift_card_by_code(state, &code)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no gift card with code {code}")))
}

pub async fn create_gift_card(
    state: &AppState,
    input: CreateGiftCardInput,
) -> Result<GiftCard, AppError> {
    let mut tx = state.db().begin().await?;
    let (gift_card_id, _) =
        issue_gift_card(&mut tx, &input, &state.notifications().default_region).await?;

    tx.commit().await?;

    tracing::info!(
        gift_card_id = %gift_card_id,
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
    let phone = input
        .recipient_phone
        .as_deref()
        .map(|raw| recipient_phone(raw, &state.notifications().default_region))
        .transpose()?;
    repository::update_gift_card(
        state,
        gift_card_id,
        input.is_active,
        input.bought_for.as_deref(),
        phone.as_deref(),
    )
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
    let code = normalize_code(code)?;
    let card = repository::lock_by_code(tx, &code)
        .await?
        .ok_or_else(|| AppError::BadRequest(format!("no gift card with code {code}")))?;

    check_redeemable(&card, &code, amount, on)?;

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
    fn new_codes_use_three_readable_groups_and_avoid_ambiguous_characters() {
        for _ in 0..64 {
            let code = generate_code();
            let groups: Vec<_> = code.split('-').collect();
            assert_eq!(groups.len(), 4);
            assert_eq!(groups[0], "GC");
            for group in &groups[1..] {
                assert_eq!(group.len(), 4);
                assert!(group.bytes().all(|c| CODE_ALPHABET.contains(&c)));
                assert!(!group.bytes().any(|c| b"01IO".contains(&c)));
            }
        }
    }

    #[test]
    fn short_codes_accept_optional_prefix_and_separators() {
        for input in [
            "GC-7KMP-4RWT-9DXH",
            "gc7kmp4rwt9dxh",
            "7KMP4RWT9DXH",
            " 7kmp 4rwt 9dxh ",
        ] {
            assert_eq!(
                normalize_code(input).unwrap(),
                "GC-7KMP-4RWT-9DXH",
                "{input}"
            );
        }
    }

    #[test]
    fn normalize_code_rejects_invalid_formats() {
        for input in [
            "GC-ABC123",
            "GC-0123456789ABCDEF0123456789ABCDEF",
            "7KMP4RWT9DX",
            "7KMP4RWT9DX0",
            "7KMP4RWT9DXI",
            "7KMP4RWT9DXé",
            "七KMP4RWT9DXH",
        ] {
            assert!(
                matches!(normalize_code(input), Err(AppError::BadRequest(_))),
                "{input}"
            );
        }
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
        for amount in [0.0, -50.0, f64::NAN, f64::INFINITY] {
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
