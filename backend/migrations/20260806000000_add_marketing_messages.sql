-- Whether this customer has agreed to receive marketing messages over
-- WhatsApp. Defaults FALSE (opt-in, not opt-out) per WhatsApp business
-- messaging policy — a customer only becomes a broadcast candidate once
-- someone explicitly flips this, either at signup or later.
ALTER TABLE customers ADD COLUMN marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- A generic outbox for anything sent to a customer over an external channel.
-- `kind` is *why* the message exists — a staff-composed marketing broadcast
-- today; a system-triggered transactional notice (e.g. an invoice receipt)
-- later — and `channel` is *how* it goes out. Both live once per campaign
-- rather than per recipient, since they're decided at compose time. Only
-- 'marketing' / 'whatsapp' are allowed today; adding a transactional kind or
-- a second channel later is an additive CHECK-constraint migration, not a
-- table redesign.
CREATE TABLE notification_campaigns (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    kind TEXT NOT NULL CHECK (kind IN ('marketing')),
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp')),
    -- The single pre-approved WhatsApp template this campaign fills in. A
    -- fixed default until there is more than one template to pick from.
    template_name TEXT NOT NULL DEFAULT 'marketing_broadcast_v1',
    body TEXT NOT NULL,
    -- The staff member's auth subject (see auth.rs's AuthenticatedUser). Not
    -- a foreign key — there is no local user table yet (see features/users).
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (campaign, customer) — the outbox proper. A future
-- transactional notification is just a second `kind` of campaign creating
-- rows here, not a new table. The status lifecycle (pending -> sent/failed)
-- is what lets a real background poller replace the stub's inline dispatch
-- later with no schema change: it only changes who flips the status.
CREATE TABLE notification_recipients (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    campaign_id UUID NOT NULL REFERENCES notification_campaigns(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    -- Snapshotted at send time so a later change to the customer's number
    -- doesn't rewrite where history says this message actually went.
    mobile_no TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    -- Opaque id handed back by the provider (Twilio/Meta message SID) once a
    -- real client replaces the stub. NULL until then.
    provider_message_id TEXT,
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    UNIQUE (campaign_id, customer_id)
);
