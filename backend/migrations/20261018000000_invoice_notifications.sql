ALTER TABLE customers ADD COLUMN whatsapp_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'ready', 'received'));
ALTER TABLE orders ADD COLUMN ready_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN ready_by TEXT;
ALTER TABLE orders ADD COLUMN readiness_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN ready_location_id UUID REFERENCES branch(id);
ALTER TABLE invoices ADD COLUMN notification_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN readiness_generation BIGINT NOT NULL DEFAULT 0;

CREATE VIEW invoice_readiness AS
SELECT i.id AS invoice_id, i.readiness_generation,
       count(o.id)::bigint AS order_count,
       count(o.id) FILTER (WHERE o.status = 'ready')::bigint AS ready_order_count,
       count(o.id) FILTER (WHERE o.status = 'pending')::bigint AS pending_order_count,
       count(o.id) FILTER (WHERE o.status = 'received')::bigint AS collected_order_count,
       CASE WHEN count(o.id) = 0 THEN 'not_applicable'
            WHEN count(o.id) FILTER (WHERE o.status <> 'received') = 0 THEN 'collected'
            WHEN count(o.id) FILTER (WHERE o.status = 'pending') = 0 THEN 'ready'
            WHEN count(o.id) FILTER (WHERE o.status = 'ready') > 0 THEN 'partially_ready'
            ELSE 'in_progress' END AS readiness_status
FROM invoices i LEFT JOIN orders o ON o.invoice_id = i.id
GROUP BY i.id;

-- All eligibility-changing writes serialize on the invoice, including existing
-- repository paths. A stage/repair/location change cannot leave stale readiness.
CREATE FUNCTION lock_order_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_key UUID; invoice_key UUID;
BEGIN
    IF TG_TABLE_NAME = 'orders' THEN
        IF TG_OP = 'DELETE' THEN invoice_key := OLD.invoice_id;
        ELSE invoice_key := NEW.invoice_id; END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN order_key := OLD.order_id;
        ELSE order_key := NEW.order_id; END IF;
        SELECT invoice_id INTO invoice_key FROM orders WHERE id = order_key;
    END IF;
    PERFORM 1 FROM invoices WHERE id = invoice_key FOR UPDATE;
    IF pg_trigger_depth() = 1 THEN
        UPDATE invoices SET notification_revision = notification_revision + 1 WHERE id = invoice_key;
    END IF;
    IF TG_TABLE_NAME = 'orders' AND TG_OP = 'UPDATE' THEN
        IF NEW.production_branch_id IS DISTINCT FROM OLD.production_branch_id AND OLD.status = 'ready' THEN
            NEW.status := 'pending'; NEW.ready_at := NULL; NEW.ready_by := NULL;
            NEW.ready_location_id := NULL; NEW.readiness_version := OLD.readiness_version + 1;
        END IF;
    ELSIF TG_TABLE_NAME = 'order_stage_progress' THEN
        UPDATE orders SET status = 'pending', ready_at = NULL, ready_by = NULL,
            ready_location_id = NULL, readiness_version = readiness_version + 1
        WHERE id = order_key AND status = 'ready';
    ELSIF TG_TABLE_NAME = 'order_repairs' THEN
        IF TG_OP <> 'DELETE' AND NEW.status IN ('open', 'in_progress') THEN
            UPDATE orders SET status = 'pending', ready_at = NULL, ready_by = NULL,
                ready_location_id = NULL, readiness_version = readiness_version + 1
            WHERE id = order_key AND status = 'ready';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_lock_invoice BEFORE INSERT OR UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION lock_order_invoice();
CREATE TRIGGER progress_lock_invoice BEFORE INSERT OR UPDATE OR DELETE ON order_stage_progress FOR EACH ROW EXECUTE FUNCTION lock_order_invoice();
CREATE TRIGGER repairs_lock_invoice BEFORE INSERT OR UPDATE OR DELETE ON order_repairs FOR EACH ROW EXECUTE FUNCTION lock_order_invoice();

CREATE FUNCTION invoice_notification_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.notification_revision := OLD.notification_revision + 1;
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
        UPDATE orders SET status = 'pending', ready_at = NULL, ready_by = NULL,
            ready_location_id = NULL, readiness_version = readiness_version + 1
        WHERE invoice_id = OLD.id AND status = 'ready';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER invoices_notification_revision BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_notification_revision();

CREATE TABLE document_artifacts (
    id UUID PRIMARY KEY DEFAULT uuidv7(), invoice_id UUID NOT NULL REFERENCES invoices(id),
    source_hash TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    sha256 TEXT NOT NULL, byte_length BIGINT NOT NULL CHECK (byte_length > 0), content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (invoice_id, source_hash)
);
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuidv7(), invoice_id UUID NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('invoice_created','invoice_updated','invoice_ready','manual_resend')),
    event_key TEXT NOT NULL, source_hash TEXT NOT NULL, preview_version UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','stale','cancelled')),
    snapshot JSONB NOT NULL, artifact_id UUID REFERENCES document_artifacts(id),
    created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by TEXT, approved_at TIMESTAMPTZ, resend_of UUID REFERENCES notifications(id)
);
CREATE UNIQUE INDEX notifications_active_event ON notifications(invoice_id,event_key) WHERE state IN ('draft','approved');
-- Once approved, a business event cannot be approved again even if its queue
-- later becomes stale or is cancelled. Intentional resends get a new event key.
CREATE UNIQUE INDEX notifications_approved_event ON notifications(invoice_id,event_key) WHERE approved_at IS NOT NULL;
CREATE TABLE notification_recipients (
    id UUID PRIMARY KEY DEFAULT uuidv7(), notification_id UUID NOT NULL REFERENCES notifications(id),
    normalized_mobile TEXT NOT NULL CHECK (normalized_mobile ~ '^\+[1-9][0-9]{7,14}$'),
    customers JSONB NOT NULL, selected BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','submitting','accepted','delivered','read','failed','uncertain','cancelled')),
    provider_message_id TEXT UNIQUE, attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), claimed_at TIMESTAMPTZ,
    error_message TEXT, sent_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(notification_id, normalized_mobile)
);
CREATE INDEX notification_delivery_queue ON notification_recipients(next_attempt_at) WHERE status = 'queued';
CREATE TABLE notification_attempts (
    id UUID PRIMARY KEY DEFAULT uuidv7(), recipient_id UUID NOT NULL REFERENCES notification_recipients(id),
    attempt_number INTEGER NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    outcome TEXT, provider_message_id TEXT, error_message TEXT,
    UNIQUE(recipient_id, attempt_number)
);

CREATE TABLE whatsapp_webhook_events (
    id BIGSERIAL PRIMARY KEY, event_hash TEXT NOT NULL UNIQUE, payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE, last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_webhook_pending ON whatsapp_webhook_events(id) WHERE NOT processed;

CREATE FUNCTION payment_notification_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN invoice_key := OLD.invoice_id; ELSE invoice_key := NEW.invoice_id; END IF;
    PERFORM 1 FROM invoices WHERE id=invoice_key FOR UPDATE;
    UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER payments_notification_revision BEFORE INSERT OR UPDATE OR DELETE ON invoice_payments FOR EACH ROW EXECUTE FUNCTION payment_notification_revision();

CREATE FUNCTION customer_notification_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key UUID;
BEGIN
    IF (NEW.name,NEW.mobile_no,NEW.whatsapp_notifications_enabled) IS DISTINCT FROM (OLD.name,OLD.mobile_no,OLD.whatsapp_notifications_enabled) THEN
        FOR invoice_key IN SELECT i.id FROM invoices i WHERE i.customer_id=OLD.id OR EXISTS(SELECT 1 FROM orders o JOIN measurements m ON m.id=o.measurement_id WHERE o.invoice_id=i.id AND m.customer_id=OLD.id) ORDER BY i.id LOOP
            UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER customers_notification_revision BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION customer_notification_revision();
