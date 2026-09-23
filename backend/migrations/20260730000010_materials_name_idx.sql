-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS materials_name_idx ON materials (name);
