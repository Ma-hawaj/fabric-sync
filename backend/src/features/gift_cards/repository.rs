use chrono::NaiveDate;
use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{GiftCard, GiftCardBalance};

const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            COALESCE(g.issued_by, (
                SELECT i.created_by FROM invoice_items item
                JOIN invoices i ON i.id = item.invoice_id
                WHERE item.gift_card_id = g.id AND item.kind = 'gift_card'
                ORDER BY item.id LIMIT 1
            )) AS issued_by,
            EXISTS(SELECT 1 FROM invoice_items WHERE gift_card_id=gift_card_original_id(g.id) AND kind='gift_card') AS taxed_at_issue,
            g.replaces_card_id,
            original.code AS replaces_card_code,
            replacement.id AS replaced_by_card_id,
            replacement.code AS replaced_by_card_code,
            g.id,
            g.code,
            g.initial_amount::float8 AS initial_amount,
            g.balance::float8 AS balance,
            g.customer_id,
            c.name AS customer_name,
            g.bought_for,
            g.recipient_phone,
            delivery.state AS delivery_status,
            delivery.last_error AS delivery_error,
            g.expires_on,
            g.is_active,
            -- Mirrors `giftCardStatus` in the frontend and `check_redeemable`
            -- in this feature's service, including permanently retired codes
            -- with a replacement. The list filters on the combined status.
            CASE
                WHEN replacement.id IS NOT NULL THEN 'replaced'
                WHEN NOT g.is_active THEN 'voided'
                WHEN g.balance <= 0 THEN 'spent'
                WHEN g.expires_on IS NOT NULL AND g.expires_on < CURRENT_DATE THEN 'expired'
                ELSE 'active'
            END AS status
        FROM gift_cards g
        LEFT JOIN gift_cards original ON original.id = g.replaces_card_id
        LEFT JOIN gift_cards replacement ON replacement.replaces_card_id = g.id
        LEFT JOIN customers c ON c.id = g.customer_id
        LEFT JOIN LATERAL (
            SELECT CASE WHEN recipient.status = 'submitting' THEN 'sending' ELSE recipient.status END AS state,
                   recipient.error_message AS last_error
            FROM notifications send JOIN notification_recipients recipient ON recipient.notification_id = send.id
            WHERE send.gift_card_id = g.id AND send.approved_at IS NOT NULL
            ORDER BY send.approved_at DESC, send.id DESC LIMIT 1
        ) delivery ON TRUE
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("code", ColumnDef::new("code", ColumnKind::Text)),
        ("boughtFor", ColumnDef::new("bought_for", ColumnKind::Text)),
        (
            "recipientPhone",
            ColumnDef::new("recipient_phone", ColumnKind::Text),
        ),
        (
            "deliveryStatus",
            ColumnDef::new("delivery_status", ColumnKind::Text),
        ),
        (
            "initialAmount",
            ColumnDef::new("initial_amount", ColumnKind::Number),
        ),
        ("balance", ColumnDef::new("balance", ColumnKind::Number)),
        (
            "customerName",
            ColumnDef::new("customer_name", ColumnKind::Text),
        ),
        ("expiresOn", ColumnDef::new("expires_on", ColumnKind::Date)),
        ("isActive", ColumnDef::new("is_active", ColumnKind::Bool)),
        ("status", ColumnDef::new("status", ColumnKind::Text)),
    ],
    default_order: "id DESC",
};

pub async fn list_gift_cards(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<GiftCard>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn get_gift_card(
    state: &AppState,
    gift_card_id: Uuid,
) -> Result<Option<GiftCard>, AppError> {
    list::fetch_by_id(state.db(), &SPEC, gift_card_id).await
}

pub(super) async fn get_gift_card_in_tx(
    tx: &mut sqlx::PgTransaction<'_>,
    id: Uuid,
) -> Result<GiftCard, AppError> {
    Ok(
        sqlx::query_as::<_, GiftCard>(&format!("{} WHERE g.id = $1", SPEC.base_sql))
            .bind(id)
            .fetch_one(&mut **tx)
            .await?,
    )
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
            COALESCE(g.issued_by, (
                SELECT i.created_by FROM invoice_items item
                JOIN invoices i ON i.id = item.invoice_id
                WHERE item.gift_card_id = g.id AND item.kind = 'gift_card'
                ORDER BY item.id LIMIT 1
            )) AS "issued_by?",
            EXISTS(SELECT 1 FROM invoice_items WHERE gift_card_id=gift_card_original_id(g.id) AND kind='gift_card') AS "taxed_at_issue!",
            g.replaces_card_id,
            original.code AS "replaces_card_code?",
            replacement.id AS "replaced_by_card_id?",
            replacement.code AS "replaced_by_card_code?",
            g.id,
            g.code,
            g.initial_amount::float8 AS "initial_amount!",
            g.balance::float8 AS "balance!",
            g.customer_id,
            c.name AS "customer_name?",
            g.bought_for,
            g.recipient_phone,
            delivery.state AS "delivery_status?",
            delivery.last_error AS "delivery_error?",
            g.expires_on,
            g.is_active
        FROM gift_cards g
        LEFT JOIN gift_cards original ON original.id = g.replaces_card_id
        LEFT JOIN gift_cards replacement ON replacement.replaces_card_id = g.id
        LEFT JOIN customers c ON c.id = g.customer_id
        LEFT JOIN LATERAL (
            SELECT CASE WHEN recipient.status = 'submitting' THEN 'sending' ELSE recipient.status END AS state,
                   recipient.error_message AS last_error
            FROM notifications send JOIN notification_recipients recipient ON recipient.notification_id = send.id
            WHERE send.gift_card_id = g.id AND send.approved_at IS NOT NULL
            ORDER BY send.approved_at DESC, send.id DESC LIMIT 1
        ) delivery ON TRUE
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
    bought_for: Option<&str>,
    recipient_phone: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO gift_cards (code, initial_amount, balance, customer_id, expires_on, bought_for, recipient_phone)
        VALUES ($1, $2::float8, $2::float8, $3, $4, NULLIF(BTRIM($5), ''), $6)
        RETURNING id
        "#,
        code,
        amount,
        customer_id,
        expires_on,
        bought_for,
        recipient_phone,
    )
    .fetch_one(&mut **tx)
    .await
}

// A collision must not abort the caller's invoice transaction before retrying.
pub async fn try_insert_generated_gift_card(
    tx: &mut sqlx::PgTransaction<'_>,
    code: &str,
    amount: f64,
    customer_id: Option<Uuid>,
    expires_on: Option<NaiveDate>,
    bought_for: Option<&str>,
    recipient_phone: &str,
    issued_by: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    Ok(sqlx::query_scalar!(
        r#"
        INSERT INTO gift_cards (code, initial_amount, balance, customer_id, expires_on, bought_for, recipient_phone, issued_by)
        VALUES ($1, $2::float8, $2::float8, $3, $4, NULLIF(BTRIM($5), ''), $6, $7)
        ON CONFLICT (code) DO NOTHING
        RETURNING id
        "#,
        code, amount, customer_id, expires_on, bought_for, recipient_phone, issued_by,
    ).fetch_optional(&mut **tx).await?)
}

pub async fn update_gift_card(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_id: Uuid,
    is_active: Option<bool>,
    bought_for: Option<&str>,
    recipient_phone: Option<&str>,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        UPDATE gift_cards
        SET is_active = COALESCE($2, is_active),
            bought_for = CASE WHEN $3::text IS NULL THEN bought_for ELSE NULLIF(BTRIM($3), '') END,
            recipient_phone = COALESCE($4, recipient_phone)
        WHERE id = $1
        RETURNING id
        "#,
        gift_card_id,
        is_active,
        bought_for,
        recipient_phone,
    )
    .fetch_optional(&mut **tx)
    .await
}

/// Lock a card before replacement, recipient/status edits, or forwarding a refund.
pub async fn lock_by_id(
    tx: &mut sqlx::PgTransaction<'_>,
    id: Uuid,
) -> Result<Option<GiftCardBalance>, sqlx::Error> {
    sqlx::query_as!(
        GiftCardBalance,
        r#"SELECT id, balance::float8 AS "balance!", is_active, expires_on
           FROM gift_cards WHERE id=$1 FOR UPDATE"#,
        id,
    )
    .fetch_optional(&mut **tx)
    .await
}

/// Find the latest replacement while locking each predecessor before following its link.
pub async fn lock_current_card(
    tx: &mut sqlx::PgTransaction<'_>,
    mut id: Uuid,
) -> Result<GiftCardBalance, sqlx::Error> {
    loop {
        let card = lock_by_id(tx, id).await?.ok_or(sqlx::Error::RowNotFound)?;
        let next: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM gift_cards WHERE replaces_card_id=$1")
                .bind(id)
                .fetch_optional(&mut **tx)
                .await?;
        match next {
            Some(next) => id = next,
            None => return Ok(card),
        }
    }
}

/// Link a fresh card to its predecessor and retire the old balance in the same transaction.
pub async fn transfer_replacement(
    tx: &mut sqlx::PgTransaction<'_>,
    original: Uuid,
    replacement: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE gift_cards SET replaces_card_id=$2 WHERE id=$1")
        .bind(replacement)
        .bind(original)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE gift_cards SET balance=0, is_active=false WHERE id=$1")
        .bind(original)
        .execute(&mut **tx)
        .await?;
    Ok(())
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
