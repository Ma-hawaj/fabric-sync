-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_payment_status_idx ON invoices (payment_status);
