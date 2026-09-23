-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS measurements_customer_id_idx ON measurements (customer_id);
