-- Invoices are settled in up to two payments: an advance paid up front (at
-- invoice creation) and a final payment that settles the remaining balance
-- (when the order is received). Each can be made through a different method.
ALTER TABLE invoices
    ADD COLUMN advance_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
    ADD COLUMN advance_payment_type TEXT
        CHECK (advance_payment_type IN ('benefit', 'cash', 'card')),
    ADD COLUMN final_payment_type TEXT
        CHECK (final_payment_type IN ('benefit', 'cash', 'card'));
