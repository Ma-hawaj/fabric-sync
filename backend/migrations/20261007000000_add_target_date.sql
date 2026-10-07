-- The invoice's creation date (invoice_date) is server-set and immutable; staff
-- instead promise a delivery date per invoice. Backfills from invoice_date so
-- existing rows satisfy the NOT NULL below.
ALTER TABLE invoices ADD COLUMN target_date DATE;
UPDATE invoices SET target_date = invoice_date WHERE target_date IS NULL;
ALTER TABLE invoices ALTER COLUMN target_date SET NOT NULL;
