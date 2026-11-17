-- Automatic replies are independent of staff-approved invoice notifications.
CREATE TABLE whatsapp_auto_reply_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 4096),
    cooldown_hours INTEGER NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 1 AND 168),
    max_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (max_per_minute BETWEEN 1 AND 60),
    updated_by TEXT,
    CHECK (NOT enabled OR char_length(btrim(message)) > 0)
);
INSERT INTO whatsapp_auto_reply_settings(singleton) VALUES(TRUE);

CREATE TABLE whatsapp_auto_reply_contacts (
    phone_number_id TEXT NOT NULL,
    customer_key TEXT NOT NULL,
    last_attempt_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(phone_number_id, customer_key)
);

CREATE TABLE whatsapp_auto_replies (
    inbound_message_id TEXT PRIMARY KEY,
    phone_number_id TEXT NOT NULL,
    customer_key TEXT NOT NULL,
    destination TEXT NOT NULL,
    destination_field TEXT NOT NULL CHECK (destination_field IN ('to', 'recipient')),
    received_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    status TEXT NOT NULL DEFAULT 'suppressed' CHECK (status IN (
        'suppressed', 'queued', 'submitting', 'accepted', 'failed', 'uncertain', 'cancelled'
    )),
    attempted_at TIMESTAMPTZ,
    provider_message_id TEXT UNIQUE,
    error_message TEXT
);
CREATE UNIQUE INDEX whatsapp_auto_reply_one_pending_contact
    ON whatsapp_auto_replies(phone_number_id, customer_key)
    WHERE status IN ('queued', 'submitting');
CREATE INDEX whatsapp_auto_reply_queue ON whatsapp_auto_replies(created_at)
    WHERE status = 'queued';
CREATE INDEX whatsapp_auto_reply_rate ON whatsapp_auto_replies(attempted_at)
    WHERE attempted_at IS NOT NULL;
