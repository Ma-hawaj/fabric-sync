-- no-transaction
-- Default sort orders and the columns the toolbars filter on.
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_name_idx ON customers (name);
