-- Indexes for server-side list queries.
--
-- Until now every list endpoint returned its whole table and the browser did
-- the filtering, so nothing but the primary keys and unique constraints was
-- ever used to look a row up. Now that filtering, sorting and paging happen in
-- Postgres, two classes of column matter:
--
--   * the join keys the list queries traverse — these carry the most weight,
--     because the invoice list's lateral aggregates run per invoice row; and
--   * the columns the tables sort and filter on by default.
--
-- Columns already covered by a UNIQUE constraint (branch.name, products.sku,
-- gift_cards.code, material_stock/product_stock's composite keys, and
-- order_stage_progress/order_stage_assignments' (order_id, stage_id) pairs,
-- whose leftmost column already serves an order_id-only lookup) are indexed
-- as a side effect of that constraint and are deliberately absent here.

-- Join keys. Postgres does not index foreign keys automatically, and each of
-- these is on the inner side of a join in the orders or invoices list query.
CREATE INDEX IF NOT EXISTS orders_invoice_id_idx ON orders (invoice_id);
CREATE INDEX IF NOT EXISTS orders_measurement_id_idx ON orders (measurement_id);
CREATE INDEX IF NOT EXISTS orders_material_id_idx ON orders (material_id);
-- Joined for the explicit-production side of `current_stage`'s applicability
-- check (see orders/repository.rs), and batch-looked-up by
-- `single_stock_locations` for the inferred side.
CREATE INDEX IF NOT EXISTS orders_production_branch_id_idx ON orders (production_branch_id);
CREATE INDEX IF NOT EXISTS measurements_customer_id_idx ON measurements (customer_id);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx ON invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS invoices_customer_id_idx ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS gift_cards_customer_id_idx ON gift_cards (customer_id);
-- Batch-looked-up per page by `list_repairs` (`WHERE order_id = ANY($1)`);
-- no UNIQUE constraint on this table covers it the way the progress and
-- assignment tables' (order_id, stage_id) keys do.
CREATE INDEX IF NOT EXISTS order_repairs_order_id_idx ON order_repairs (order_id);

-- Default sort orders and the columns the toolbars filter on.
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);
CREATE INDEX IF NOT EXISTS materials_name_idx ON materials (name);
CREATE INDEX IF NOT EXISTS products_name_idx ON products (name);
CREATE INDEX IF NOT EXISTS invoices_invoice_date_idx ON invoices (invoice_date);
CREATE INDEX IF NOT EXISTS invoices_payment_status_idx ON invoices (payment_status);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
