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
CREATE INDEX orders_invoice_id_idx ON orders (invoice_id);
CREATE INDEX orders_measurement_id_idx ON orders (measurement_id);
CREATE INDEX orders_material_id_idx ON orders (material_id);
-- Joined for the explicit-production side of `current_stage`'s applicability
-- check (see orders/repository.rs), and batch-looked-up by
-- `single_stock_locations` for the inferred side.
CREATE INDEX orders_production_branch_id_idx ON orders (production_branch_id);
CREATE INDEX measurements_customer_id_idx ON measurements (customer_id);
CREATE INDEX invoice_items_invoice_id_idx ON invoice_items (invoice_id);
CREATE INDEX invoices_customer_id_idx ON invoices (customer_id);
-- The per-invoice ledger aggregates (`SUM(amount)`, the latest method) run
-- once per row of the invoices list and once per order row's invoice join.
CREATE INDEX invoice_payments_invoice_id_idx ON invoice_payments (invoice_id);
CREATE INDEX gift_cards_customer_id_idx ON gift_cards (customer_id);
-- Batch-looked-up per page by `list_repairs` (`WHERE order_id = ANY($1)`);
-- no UNIQUE constraint on this table covers it the way the progress and
-- assignment tables' (order_id, stage_id) keys do.
CREATE INDEX order_repairs_order_id_idx ON order_repairs (order_id);

-- Default sort orders and the columns the toolbars filter on.
CREATE INDEX customers_name_idx ON customers (name);
CREATE INDEX materials_name_idx ON materials (name);
CREATE INDEX products_name_idx ON products (name);
CREATE INDEX invoices_invoice_date_idx ON invoices (invoice_date);
CREATE INDEX orders_status_idx ON orders (status);

-- Picker order per category, and the admin table's default sort.
CREATE INDEX design_options_category_idx
    ON design_options (category, sort_order);

-- Return-line lookups and one closure per whole tailoring garment.
CREATE INDEX invoice_return_lines_order_idx ON invoice_return_lines(order_id);
CREATE INDEX invoice_return_lines_item_idx ON invoice_return_lines(item_id);
CREATE UNIQUE INDEX invoice_return_lines_order_once
    ON invoice_return_lines(order_id) WHERE order_id IS NOT NULL;
