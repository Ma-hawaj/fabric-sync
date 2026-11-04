-- Tender and previously taxed value are different: uninvoiced credit settles
-- the customer's balance while VAT remains due on the supplied goods/services.
-- Derive prepaid value from the issued tax snapshot so reprints are stable.
CREATE OR REPLACE VIEW invoice_voucher_accounting AS
SELECT i.id AS invoice_id,
       COALESCE(cards.amount, 0)::numeric(10,2) AS gift_card_sales,
       (i.total_price - i.taxable_amount - i.vat_amount)::numeric(10,2) AS prepaid_amount,
       CASE WHEN i.gift_card_redeemed > 0
                  AND i.gift_card_redeemed = i.total_price
                  AND i.taxable_amount = 0 AND i.vat_amount = 0
            THEN 'redemption_receipt' ELSE 'tax_invoice' END AS document_kind,
       ROUND(GREATEST(balance.net_total - COALESCE(cards.amount, 0), 0)
             / (1 + i.vat_rate), 2) AS sales_amount
FROM invoices i
JOIN invoice_balances balance ON balance.invoice_id = i.id
LEFT JOIN LATERAL (
    SELECT SUM(line_total) AS amount FROM invoice_items
    WHERE invoice_id = i.id AND kind = 'gift_card'
) cards ON true;
