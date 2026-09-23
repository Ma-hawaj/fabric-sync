-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_invoice_date_idx ON invoices (invoice_date);
