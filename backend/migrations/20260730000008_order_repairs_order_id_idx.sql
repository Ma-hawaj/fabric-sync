-- no-transaction
-- Batch-looked-up per page by `list_repairs` (`WHERE order_id = ANY($1)`);
-- no UNIQUE constraint on this table covers it the way the progress and
-- assignment tables' (order_id, stage_id) keys do.
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_repairs_order_id_idx ON order_repairs (order_id);
