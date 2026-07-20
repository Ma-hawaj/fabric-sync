ALTER TABLE orders
    ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'received')),
    ADD COLUMN received_at TIMESTAMPTZ;

-- invoices.amount_paid/payment_status already track the running total paid
-- and current settlement state. These add the payment *method* for each of
-- an invoice's up-to-two payments — the advance taken at invoice creation,
-- and the final payment that settles the remaining balance once the order
-- is received — plus a snapshot of the advance amount, since amount_paid is
-- overwritten to total_price once the final payment settles the balance.
ALTER TABLE invoices
    ADD COLUMN advance_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
    ADD COLUMN advance_payment_type TEXT
        CHECK (advance_payment_type IN ('benefit', 'cash', 'card')),
    ADD COLUMN final_payment_type TEXT
        CHECK (final_payment_type IN ('benefit', 'cash', 'card'));
