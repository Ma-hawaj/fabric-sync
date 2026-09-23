-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoice_items_invoice_id_idx ON invoice_items (invoice_id);
