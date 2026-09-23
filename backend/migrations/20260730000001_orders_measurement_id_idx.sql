-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_measurement_id_idx ON orders (measurement_id);
