-- Transaction totals include stored-value funding. Merchandise sales exclude it;
-- they include goods paid with a voucher, and are reduced by return credits.
CREATE VIEW invoice_voucher_accounting AS
SELECT i.id AS invoice_id,
       COALESCE(cards.amount, 0)::numeric(10,2) AS gift_card_sales,
       i.gift_card_redeemed AS prepaid_amount,
       CASE WHEN i.gift_card_redeemed > 0 AND i.gift_card_redeemed = i.total_price
            THEN 'redemption_receipt' ELSE 'tax_invoice' END AS document_kind,
       ROUND(GREATEST(balance.net_total - COALESCE(cards.amount, 0), 0)
             / (1 + i.vat_rate), 2) AS sales_amount
FROM invoices i
JOIN invoice_balances balance ON balance.invoice_id = i.id
LEFT JOIN LATERAL (
    SELECT SUM(line_total) AS amount FROM invoice_items
    WHERE invoice_id = i.id AND kind = 'gift_card'
) cards ON true;
