-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_name_idx ON products (name);
