-- Every payment against an invoice, in the order it was taken: advances at
-- creation, per-pickup payments when orders are collected one by one, the
-- final settlement, and till payments in between. Previously an invoice could
-- only record two payments (advance_amount/advance_payment_type at creation
-- and final_payment_type at settlement), so collecting a multi-order invoice
-- order-by-order recorded no money until the last pickup settled everything
-- at once. payment_status and amount_paid are now derived from these rows
-- (see invoices/service.rs payment_summary) rather than stored.
CREATE TABLE invoice_payments (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    -- The pickup this payment was taken at, when it was taken at one. NULL
    -- for advances and till payments not tied to a collection.
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    -- Nullable: the app always records a method, but legacy rows imported
    -- from the workbook (see scripts/ingest_xlsm.py) may not have one.
    payment_type TEXT CHECK (payment_type IN ('benefit', 'cash', 'card')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX invoice_payments_invoice_id_idx ON invoice_payments (invoice_id);

-- Backfill, in the same order money moved: first what was taken up front,
-- then what settled the balance.
INSERT INTO invoice_payments (invoice_id, order_id, amount, payment_type, paid_at)
SELECT id, NULL, advance_amount, advance_payment_type, created_at
FROM invoices
WHERE advance_amount > 0;

INSERT INTO invoice_payments (invoice_id, order_id, amount, payment_type, paid_at)
SELECT id, NULL, total_price - gift_card_redeemed - advance_amount, final_payment_type, created_at
FROM invoices
WHERE final_payment_type IS NOT NULL
  AND total_price - gift_card_redeemed - advance_amount > 0;

-- A paid invoice whose final payment recorded no method still owes nothing:
-- carry the remainder across so the derived status stays paid.
INSERT INTO invoice_payments (invoice_id, order_id, amount, payment_type, paid_at)
SELECT id, NULL, total_price - gift_card_redeemed - advance_amount, NULL, created_at
FROM invoices
WHERE payment_status = 'paid'
  AND final_payment_type IS NULL
  AND total_price - gift_card_redeemed - advance_amount > 0;

ALTER TABLE invoices
    DROP COLUMN amount_paid,
    DROP COLUMN advance_amount,
    DROP COLUMN advance_payment_type,
    DROP COLUMN final_payment_type,
    DROP COLUMN payment_status;
