ALTER TABLE customers ADD COLUMN address TEXT;

ALTER TABLE invoices
    ADD COLUMN is_urgent BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN urgent_charge NUMERIC(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN collection_method TEXT NOT NULL DEFAULT 'pickup',
    ADD CONSTRAINT invoices_collection_method_check
        CHECK (collection_method IN ('delivery', 'pickup')),
    ADD CONSTRAINT invoices_urgent_charge_check
        CHECK ((is_urgent AND urgent_charge > 0) OR (NOT is_urgent AND urgent_charge = 0));

-- Address changes affect the rendered invoice just like customer contact details.
CREATE OR REPLACE FUNCTION customer_notification_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key UUID;
BEGIN
    IF (NEW.name,NEW.mobile_no,NEW.whatsapp_notifications_enabled,NEW.address) IS DISTINCT FROM (OLD.name,OLD.mobile_no,OLD.whatsapp_notifications_enabled,OLD.address) THEN
        FOR invoice_key IN SELECT i.id FROM invoices i WHERE i.customer_id=OLD.id OR EXISTS(SELECT 1 FROM orders o JOIN measurements m ON m.id=o.measurement_id WHERE o.invoice_id=i.id AND m.customer_id=OLD.id) ORDER BY i.id LOOP
            UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
