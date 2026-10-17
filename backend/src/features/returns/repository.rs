use uuid::Uuid;

use super::types::*;

pub async fn returnable_total(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<f64, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT (i.total_price - COALESCE((
            SELECT SUM(line_total) FROM invoice_items
            WHERE invoice_id = i.id AND kind = 'gift_card'
        ), 0))::float8 AS "total!" FROM invoices i WHERE i.id = $1
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn settlement(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Settlement, sqlx::Error> {
    sqlx::query_as!(
        Settlement,
        r#"
        SELECT amount_paid::float8 AS "amount_paid!",
               amount_credited::float8 AS "amount_credited!",
               cash_refunded::float8 AS "cash_refunded!",
               gift_card_refunded::float8 AS "gift_card_refunded!",
               net_total::float8 AS "net_total!",
               net_amount_paid::float8 AS "net_amount_paid!",
               net_gift_card_redeemed::float8 AS "net_gift_card_redeemed!",
               balance_due::float8 AS "balance_due!",
               refund_due::float8 AS "refund_due!",
               payment_status AS "payment_status!"
        FROM invoice_balances WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn returnable_lines(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<ReturnableLine>, sqlx::Error> {
    sqlx::query_as!(
        ReturnableLine,
        r#"
        SELECT sold.line_id AS "line_id!", sold.kind AS "kind!",
               sold.description AS "description!", sold.quantity::float8 AS "quantity!",
               COALESCE(ret.quantity, 0)::float8 AS "returned_quantity!",
               COALESCE(ret.amount, 0)::float8 AS "credited_amount!",
               sold.line_total::float8 AS "line_total!", sold.collected AS "collected!",
               COALESCE(b.is_active AND b.holds_stock, false) AS "can_restock!",
               0::float8 AS "credit_limit!", sold.product_id AS "product_id?",
               sold.branch_id AS "branch_id?"
        FROM (
            SELECT o.id AS line_id, 'order' AS kind,
                   'Order #' || o.order_number AS description, 1::numeric AS quantity,
                   o.price AS line_total, o.status = 'received' AS collected,
                   NULL::uuid AS product_id, NULL::uuid AS branch_id
            FROM orders o WHERE o.invoice_id = $1
            UNION ALL
            SELECT id, 'product', description, quantity, line_total, true, product_id, branch_id
            FROM invoice_items WHERE invoice_id = $1 AND kind = 'product'
        ) sold
        LEFT JOIN branch b ON b.id = sold.branch_id
        LEFT JOIN LATERAL (
            SELECT SUM(quantity) AS quantity, SUM(amount) AS amount
            FROM invoice_return_lines
            WHERE order_id = sold.line_id OR item_id = sold.line_id
        ) ret ON true
        ORDER BY sold.line_id
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn history(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<ReturnRecord>, sqlx::Error> {
    sqlx::query_as!(
        ReturnRecord,
        r#"
        SELECT r.id, r.reason, r.amount::float8 AS "amount!", r.created_at, r.created_by,
               (SELECT jsonb_agg(jsonb_build_object(
                   'description', l.description, 'quantity', l.quantity::float8,
                   'amount', l.amount::float8, 'restocked', l.restocked
               ) ORDER BY l.id) FROM invoice_return_lines l WHERE l.return_id = r.id)
               AS "lines!: sqlx::types::Json<Vec<ReturnedLine>>"
        FROM invoice_returns r WHERE r.invoice_id = $1 ORDER BY r.created_at, r.id
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn refunds(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<RefundRecord>, sqlx::Error> {
    sqlx::query_as!(
        RefundRecord,
        r#"
        SELECT r.id, r.reason, r.amount::float8 AS "amount!", r.payment_type,
               g.code AS "gift_card_code?", r.created_at, r.created_by
        FROM invoice_refunds r LEFT JOIN gift_cards g ON g.id = r.gift_card_id
        WHERE r.invoice_id = $1 ORDER BY r.created_at, r.id
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn refundable_cards(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<RefundableCard>, sqlx::Error> {
    sqlx::query_as!(
        RefundableCard,
        r#"
        SELECT g.id, g.code, (r.amount - COALESCE((
            SELECT SUM(f.amount) FROM invoice_refunds f
            WHERE f.invoice_id = r.invoice_id AND f.gift_card_id = g.id
        ), 0))::float8 AS "refundable_amount!"
        FROM gift_card_redemptions r JOIN gift_cards g ON g.id = r.gift_card_id
        WHERE r.invoice_id = $1 ORDER BY g.id
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

/// Checked only after taking the same invoice lock as payments and edits.
pub async fn previous_request(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    request_id: Uuid,
    is_return: bool,
) -> Result<Option<(Uuid, serde_json::Value)>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT id AS "id!", request_payload AS "request_payload!" FROM invoice_returns
        WHERE invoice_id = $1 AND request_id = $2 AND $3
        UNION ALL
        SELECT id, request_payload FROM invoice_refunds
        WHERE invoice_id = $1 AND request_id = $2 AND NOT $3
        "#,
        invoice_id,
        request_id,
        is_return,
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(|row| (row.id, row.request_payload)))
}

pub async fn insert_return(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    input: &CreateReturnInput,
    payload: serde_json::Value,
    amount: f64,
    actor: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO invoice_returns (invoice_id, request_id, request_payload, reason, amount, created_by)
        VALUES ($1, $2, $3, $4, $5::float8, $6) RETURNING id
        "#,
        invoice_id,
        input.request_id,
        payload,
        input.reason.trim(),
        amount,
        actor,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn insert_line(
    tx: &mut sqlx::PgTransaction<'_>,
    return_id: Uuid,
    line: &ReturnableLine,
    input: &ReturnLineInput,
    amount: f64,
) -> Result<(), sqlx::Error> {
    let order_id = (line.kind == "order").then_some(line.line_id);
    let item_id = (line.kind == "product").then_some(line.line_id);
    sqlx::query!(
        r#"
        INSERT INTO invoice_return_lines (return_id, order_id, item_id, description, quantity, amount, restocked)
        VALUES ($1, $2, $3, $4, $5::float8, $6::float8, $7)
        "#,
        return_id,
        order_id,
        item_id,
        line.description,
        input.quantity,
        amount,
        input.restock,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn insert_refund(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    input: &CreateRefundInput,
    payload: serde_json::Value,
    actor: &str,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO invoice_refunds (invoice_id, request_id, request_payload, reason, amount, payment_type, gift_card_id, created_by)
        VALUES ($1, $2, $3, $4, $5::float8, $6, $7, $8) RETURNING id
        "#,
        invoice_id,
        input.request_id,
        payload,
        input.reason.trim(),
        input.amount,
        input.payment_type.as_str(),
        input.gift_card_id,
        actor,
    )
    .fetch_one(&mut **tx)
    .await
}

pub async fn has_adjustments(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT EXISTS(SELECT 1 FROM invoice_returns WHERE invoice_id = $1)
            OR EXISTS(SELECT 1 FROM invoice_refunds WHERE invoice_id = $1) AS "exists!"
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await?)
}
