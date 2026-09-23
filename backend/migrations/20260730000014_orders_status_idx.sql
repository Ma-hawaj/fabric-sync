-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_status_idx ON orders (status);
