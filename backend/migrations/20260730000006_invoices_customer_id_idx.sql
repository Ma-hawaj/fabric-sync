-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_customer_id_idx ON invoices (customer_id);
