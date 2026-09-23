-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_material_id_idx ON orders (material_id);
