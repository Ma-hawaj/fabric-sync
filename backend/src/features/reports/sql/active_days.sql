WITH events AS (
    SELECT id AS invoice_id, invoice_date AS occurred_at FROM invoices
    UNION ALL SELECT invoice_id, paid_at FROM invoice_payments
    UNION ALL SELECT invoice_id, created_at FROM invoice_returns
    UNION ALL SELECT invoice_id, created_at FROM invoice_refunds
    UNION ALL SELECT invoice_id, redeemed_at FROM gift_card_redemptions
    UNION ALL
    SELECT o.invoice_id, r.received_at FROM order_repairs r
    JOIN orders o ON o.id = r.order_id
    WHERE r.received_amount > 0 AND r.received_at IS NOT NULL
), days AS (
    SELECT (e.occurred_at AT TIME ZONE $2)::date AS day
    FROM events e JOIN invoices i ON i.id = e.invoice_id WHERE COALESCE(i.issuing_branch_id, i.branch_id) = $1
    UNION SELECT business_date FROM branch_cash_openings WHERE branch_id = $1
    UNION SELECT business_date FROM branch_expenses WHERE branch_id = $1
    UNION SELECT report_date FROM branch_closing_checks WHERE branch_id = $1
)
SELECT MIN(day) AS "day?" FROM days d
WHERE d.day < $3
AND NOT EXISTS (
    SELECT 1 FROM branch_day_closures c WHERE c.branch_id = $1 AND c.business_date = d.day
)
