use chrono::NaiveDate;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{GiftCard, GiftCardBalance};

pub async fn list_gift_cards(state: &AppState) -> Result<Vec<GiftCard>, sqlx::Error> {
    sqlx::query_as!(
        GiftCard,
        r#"
        SELECT
            g.id,
            g.code,
            g.initial_amount::float8 AS "initial_amount!",
            g.balance::float8 AS "balance!",
            g.customer_id,
            c.name AS "customer_name?",
            g.expires_on,
            g.is_active
        FROM gift_cards g
        LEFT JOIN customers c ON c.id = g.customer_id
        ORDER BY g.id DESC
        "#,
    )
    .fetch_all(state.db())
    .await
}

pub async fn get_gift_card(
    state: &AppState,
    gift_card_id: Uuid,
) -> Result<Option<GiftCard>, sqlx::Error> {
    sqlx::query_as!(
        GiftCard,
        r#"
        SELECT
            g.id,
            g.code,
            g.initial_amount::float8 AS "initial_amount!",
            g.balance::float8 AS "balance!",
            g.customer_id,
            c.name AS "customer_name?",
            g.expires_on,
            g.is_active
        FROM gift_cards g
        LEFT JOIN customers c ON c.id = g.customer_id
        WHERE g.id = $1
        "#,
        gift_card_id,
    )
    .fetch_optional(state.db())
    .await
}

// Looked up by the code staff type in at redemption time. Deliberately the only
// way the invoice form can see a card: it never loads the full list, so a code
// has to be known (i.e. the customer has to present the card) to spend it.
pub async fn get_gift_card_by_code(
    state: &AppState,
    code: &str,
) -> Result<Option<GiftCard>, sqlx::Error> {
    sqlx::query_as!(
        GiftCard,
        r#"
        SELECT
            g.id,
            g.code,
            g.initial_amount::float8 AS "initial_amount!",
            g.balance::float8 AS "balance!",
            g.customer_id,
            c.name AS "customer_name?",
            g.expires_on,
            g.is_active
        FROM gift_cards g
        LEFT JOIN customers c ON c.id = g.customer_id
        WHERE g.code = $1
        "#,
        code,
    )
    .fetch_optional(state.db())
    .await
}

// Tx-scoped so invoice creation can sell a card inside its own transaction, the
// way customers::repository's insert fns are shared with invoices. A new card's
// balance always starts at its face value.
pub async fn insert_gift_card(
    tx: &mut sqlx::PgTransaction<'_>,
    code: &str,
    amount: f64,
    customer_id: Option<Uuid>,
    expires_on: Option<NaiveDate>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO gift_cards (code, initial_amount, balance, customer_id, expires_on)
        VALUES ($1, $2::float8, $2::float8, $3, $4)
        RETURNING id
        "#,
        code,
        amount,
        customer_id,
        expires_on,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn update_gift_card(
    state: &AppState,
    gift_card_id: Uuid,
    is_active: Option<bool>,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE gift_cards
        SET is_active = COALESCE($2, is_active)
        WHERE id = $1
        RETURNING id
        "#,
        gift_card_id,
        is_active,
    )
    .fetch_optional(state.db())
    .await
}

// FOR UPDATE is what stops two invoices spending the same balance at once: the
// second redemption blocks here until the first has committed or rolled back.
pub async fn lock_by_code(
    tx: &mut sqlx::PgTransaction<'_>,
    code: &str,
) -> Result<Option<GiftCardBalance>, sqlx::Error> {
    sqlx::query_as!(
        GiftCardBalance,
        r#"
        SELECT id, balance::float8 AS "balance!", is_active, expires_on
        FROM gift_cards
        WHERE code = $1
        FOR UPDATE
        "#,
        code,
    )
    .fetch_optional(&mut **tx)
    .await
}

pub async fn decrement_balance(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_id: Uuid,
    amount: f64,
) -> Result<f64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE gift_cards
        SET balance = balance - $2::float8
        WHERE id = $1
        RETURNING balance::float8 AS "balance!"
        "#,
        gift_card_id,
        amount,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn insert_redemption(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_id: Uuid,
    invoice_id: Uuid,
    amount: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO gift_card_redemptions (gift_card_id, invoice_id, amount)
        VALUES ($1, $2, $3::float8)
        "#,
        gift_card_id,
        invoice_id,
        amount,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
