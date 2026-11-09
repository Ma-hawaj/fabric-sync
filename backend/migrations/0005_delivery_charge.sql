-- Existing invoices retain their original total and have no delivery charge.
ALTER TABLE invoices ADD COLUMN delivery_charge NUMERIC(10, 2) NOT NULL DEFAULT 0
    CHECK (delivery_charge >= 0 AND (collection_method = 'delivery' OR delivery_charge = 0));
