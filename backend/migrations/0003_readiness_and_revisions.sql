-- Derived invoice readiness and invalidation of outdated notification previews.

CREATE VIEW invoice_readiness AS
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
    -- Address changes affect the rendered invoice just like contact details.
    IF (NEW.name,NEW.mobile_no,NEW.whatsapp_notifications_enabled,NEW.address) IS DISTINCT FROM (OLD.name,OLD.mobile_no,OLD.whatsapp_notifications_enabled,OLD.address) THEN
        FOR invoice_key IN SELECT i.id FROM invoices i WHERE i.customer_id=OLD.id OR EXISTS(SELECT 1 FROM orders o JOIN measurements m ON m.id=o.measurement_id WHERE o.invoice_id=i.id AND m.customer_id=OLD.id) ORDER BY i.id LOOP
            UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER customers_notification_revision BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION customer_notification_revision();
