ALTER TABLE invoice_returns ADD COLUMN kind TEXT NOT NULL DEFAULT 'return'
    CHECK (kind IN ('return', 'cancellation'));
ALTER TABLE invoice_refunds ADD COLUMN adjustment_id UUID REFERENCES invoice_returns(id);

-- Production can be reassigned. Preserve the actual deduction location for
-- new sales; legacy rows remain unknown rather than guessing where stock left.
ALTER TABLE orders ADD COLUMN material_stock_branch_id UUID REFERENCES branch(id);

-- A whole tailoring garment is closed once, either by cancellation or return.
CREATE UNIQUE INDEX invoice_return_lines_order_once
    ON invoice_return_lines(order_id) WHERE order_id IS NOT NULL;

CREATE TABLE order_cancellations (
    order_id UUID PRIMARY KEY REFERENCES orders(id),
    adjustment_id UUID NOT NULL UNIQUE REFERENCES invoice_returns(id),
    retained_charge NUMERIC(10, 2) NOT NULL CHECK (retained_charge >= 0),
    restored_material_quantity NUMERIC(10, 2) NOT NULL CHECK (restored_material_quantity >= 0),
    stock_branch_id UUID REFERENCES branch(id),
    work_charge_confirmed BOOLEAN NOT NULL,
    unused_material_confirmed BOOLEAN NOT NULL,
    CHECK (restored_material_quantity = 0 OR (stock_branch_id IS NOT NULL AND unused_material_confirmed))
);

-- Collection timestamps and production checklists remain historical facts.
-- The outcome is a separate, derived dimension used to close operational work.
CREATE VIEW order_outcomes AS
SELECT o.id AS order_id,
    CASE WHEN r.kind = 'cancellation' THEN 'cancelled'
         WHEN r.id IS NOT NULL THEN 'returned' ELSE 'active' END AS outcome,
    r.id AS adjustment_id, r.reason, r.created_at AS closed_at, r.created_by AS closed_by,
    l.amount AS credited_amount,
    COALESCE(c.retained_charge, 0) AS retained_charge,
    COALESCE(c.restored_material_quantity, 0) AS restored_material_quantity
FROM orders o
LEFT JOIN invoice_return_lines l ON l.order_id = o.id
LEFT JOIN invoice_returns r ON r.id = l.return_id
LEFT JOIN order_cancellations c ON c.order_id = o.id;

-- Closed garments never participate in pickup readiness or ready notifications.
CREATE OR REPLACE VIEW invoice_readiness AS
SELECT i.id AS invoice_id, i.readiness_generation,
       count(o.id)::bigint AS order_count,
       count(o.id) FILTER (WHERE o.status = 'ready')::bigint AS ready_order_count,
       count(o.id) FILTER (WHERE o.status = 'pending')::bigint AS pending_order_count,
       count(o.id) FILTER (WHERE o.status = 'collected')::bigint AS collected_order_count,
       CASE WHEN count(o.id) = 0 THEN 'not_applicable'
            WHEN count(o.id) FILTER (WHERE o.status <> 'collected') = 0 THEN 'collected'
            WHEN count(o.id) FILTER (WHERE o.status = 'pending') = 0 THEN 'ready'
            WHEN count(o.id) FILTER (WHERE o.status = 'ready') > 0 THEN 'partially_ready'
            ELSE 'in_progress' END AS readiness_status
FROM invoices i LEFT JOIN orders o ON o.invoice_id = i.id
    AND NOT EXISTS (SELECT 1 FROM invoice_return_lines l WHERE l.order_id = o.id)
GROUP BY i.id;

-- Credit/refund writes change rendered invoice figures just as payments do.
-- Reuse the existing invoice lock/revision trigger to invalidate old previews.
CREATE TRIGGER returns_notification_revision AFTER INSERT ON invoice_returns
    FOR EACH ROW EXECUTE FUNCTION payment_notification_revision();
CREATE TRIGGER refunds_notification_revision AFTER INSERT ON invoice_refunds
    FOR EACH ROW EXECUTE FUNCTION payment_notification_revision();
