-- Notification work is created by application business actions, independently
-- of the broad revision counter used to reject stale previews and queued sends.
-- Deliberately do not backfill historical invoices or imported ready repairs.
CREATE TABLE notification_requests (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('invoice', 'invoice_ready', 'repair_ready')),
    repair_id UUID REFERENCES order_repairs(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((kind = 'repair_ready') = (repair_id IS NOT NULL)),
    UNIQUE NULLS NOT DISTINCT (invoice_id, kind, repair_id)
);
