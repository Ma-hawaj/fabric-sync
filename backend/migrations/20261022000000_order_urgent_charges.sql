ALTER TABLE orders
    ADD COLUMN urgent_charge NUMERIC(10, 2) NOT NULL DEFAULT 0
        CHECK (urgent_charge >= 0);

-- Preserve the amount already charged on existing invoices. Allocate whole
-- cents evenly, with the remainder on the earliest orders, so no money is
-- created or lost. invoices.urgent_charge remains the cached order-charge sum
-- for invoice totals and legacy invoices without tailoring orders.
WITH allocations AS (
    SELECT o.id, i.urgent_charge * 100 AS cents,
           count(*) OVER (PARTITION BY i.id) AS order_count,
           row_number() OVER (PARTITION BY i.id ORDER BY o.id) AS position
    FROM orders o
    JOIN invoices i ON i.id = o.invoice_id
    WHERE i.urgent_charge > 0
)
UPDATE orders o
SET urgent_charge = (
    floor(a.cents / a.order_count)
    + CASE WHEN a.position <= mod(a.cents, a.order_count) THEN 1 ELSE 0 END
) / 100
FROM allocations a
WHERE o.id = a.id;
