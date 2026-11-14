-- Both customer checkboxes describe the destination, not a customer record.
ALTER TABLE marketing_consent RENAME TO whatsapp_preferences;
ALTER TABLE whatsapp_preferences RENAME COLUMN granted TO marketing_enabled;
ALTER TABLE whatsapp_preferences RENAME COLUMN version TO marketing_version;
ALTER TABLE whatsapp_preferences RENAME COLUMN observed_at TO marketing_observed_at;
ALTER TABLE whatsapp_preferences RENAME COLUMN source TO marketing_source;
ALTER TABLE whatsapp_preferences RENAME COLUMN recorded_by TO marketing_recorded_by;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_enabled SET DEFAULT false;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_version DROP NOT NULL;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_version DROP DEFAULT;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_observed_at DROP NOT NULL;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_source DROP NOT NULL;
ALTER TABLE whatsapp_preferences ALTER COLUMN marketing_recorded_by DROP NOT NULL;
ALTER TABLE whatsapp_preferences ADD COLUMN invoice_updates_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE whatsapp_preferences ADD COLUMN invoice_version uuid;
ALTER TABLE whatsapp_preferences ADD COLUMN invoice_updated_at timestamptz;
ALTER TABLE whatsapp_preferences ADD COLUMN invoice_recorded_by text;
ALTER TABLE whatsapp_preferences ADD CONSTRAINT marketing_preference_metadata CHECK (
    (marketing_version IS NULL AND NOT marketing_enabled AND marketing_observed_at IS NULL AND marketing_source IS NULL AND marketing_recorded_by IS NULL)
    OR (marketing_version IS NOT NULL AND marketing_observed_at IS NOT NULL AND marketing_source IS NOT NULL AND marketing_recorded_by IS NOT NULL)
);

ALTER TABLE marketing_consent_events RENAME TO whatsapp_preference_events;
ALTER TABLE whatsapp_preference_events RENAME COLUMN granted TO enabled;
ALTER TABLE whatsapp_preference_events ADD COLUMN category text NOT NULL DEFAULT 'marketing'
    CHECK (category IN ('marketing', 'invoice_updates'));

-- Compatibility projections preserve the marketing API/audit shape without
-- duplicating preferences or treating an invoice setting as marketing consent.
CREATE VIEW marketing_consent AS SELECT mobile, marketing_enabled AS granted,
    marketing_version AS version, marketing_observed_at AS observed_at,
    marketing_source AS source, marketing_recorded_by AS recorded_by, updated_at
    FROM whatsapp_preferences WHERE marketing_version IS NOT NULL;
CREATE VIEW marketing_consent_events AS SELECT id,mobile,enabled AS granted,
    observed_at,source,recorded_by,provider_event_id,created_at
    FROM whatsapp_preference_events WHERE category='marketing';

-- The application completes this one-time backfill using the configured phone
-- region and the same libphonenumber parser used by delivery, before serving.
CREATE TABLE whatsapp_preference_backfill AS
    SELECT id AS customer_id, mobile_no, whatsapp_notifications_enabled AS enabled FROM customers;
ALTER TABLE whatsapp_preference_backfill ADD PRIMARY KEY(customer_id);
ALTER TABLE customers ADD COLUMN whatsapp_mobile text;
CREATE INDEX customers_whatsapp_mobile ON customers(whatsapp_mobile);

CREATE OR REPLACE FUNCTION customer_notification_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key UUID;
BEGIN
    IF (NEW.name,NEW.mobile_no,NEW.address) IS DISTINCT FROM (OLD.name,OLD.mobile_no,OLD.address) THEN
        FOR invoice_key IN SELECT i.id FROM invoices i WHERE i.customer_id=OLD.id OR EXISTS(SELECT 1 FROM orders o JOIN measurements m ON m.id=o.measurement_id WHERE o.invoice_id=i.id AND m.customer_id=OLD.id) ORDER BY i.id LOOP
            UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE customers DROP COLUMN whatsapp_notifications_enabled;

CREATE FUNCTION whatsapp_invoice_preference_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice_key UUID;
BEGIN
    IF (TG_OP='INSERT' AND NOT NEW.invoice_updates_enabled)
        OR (TG_OP='UPDATE' AND NEW.invoice_updates_enabled IS DISTINCT FROM OLD.invoice_updates_enabled) THEN
        FOR invoice_key IN
            SELECT DISTINCT i.id FROM invoices i WHERE EXISTS (
                SELECT 1 FROM customers c WHERE c.whatsapp_mobile=NEW.mobile
                AND (c.id=i.customer_id OR EXISTS(SELECT 1 FROM orders o JOIN measurements m ON m.id=o.measurement_id WHERE o.invoice_id=i.id AND m.customer_id=c.id))
            ) ORDER BY i.id
        LOOP
            UPDATE invoices SET notification_revision=notification_revision+1 WHERE id=invoice_key;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER whatsapp_invoice_preference_revision AFTER INSERT OR UPDATE ON whatsapp_preferences
    FOR EACH ROW EXECUTE FUNCTION whatsapp_invoice_preference_revision();
