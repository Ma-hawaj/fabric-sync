-- no-transaction
-- Joined for the explicit-production side of `current_stage`'s applicability
-- check (see orders/repository.rs), and batch-looked-up by
-- `single_stock_locations` for the inferred side.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_production_branch_id_idx ON orders (production_branch_id);
