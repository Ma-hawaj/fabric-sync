-- Immutable document previews, approved notifications, delivery attempts, and webhooks.

-- One stable parent for each customer notification action. Ordinary data edits
-- and imports do not create these records. Manual previews become actionable
-- only after a send is approved. Never replace a request when a new action occurs.
CREATE TABLE notification_requests (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('invoice', 'invoice_ready', 'repair_ready', 'gift_card')),
    repair_id UUID REFERENCES order_repairs(id) ON DELETE CASCADE,
    gift_card_id UUID REFERENCES gift_cards(id) ON DELETE CASCADE,
    origin TEXT NOT NULL DEFAULT 'business' CHECK (origin IN ('business', 'manual')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (
        (kind IN ('invoice', 'invoice_ready') AND invoice_id IS NOT NULL AND repair_id IS NULL AND gift_card_id IS NULL)
        OR (kind = 'repair_ready' AND invoice_id IS NOT NULL AND repair_id IS NOT NULL AND gift_card_id IS NULL)
        OR (kind = 'gift_card' AND invoice_id IS NULL AND repair_id IS NULL AND gift_card_id IS NOT NULL)
    ),
    UNIQUE (id, invoice_id),
    UNIQUE (id, gift_card_id)
);
CREATE INDEX notification_request_invoice_history
    ON notification_requests(invoice_id, kind, repair_id, requested_at DESC, id DESC);
CREATE INDEX notification_request_gift_card_history
    ON notification_requests(gift_card_id, requested_at DESC, id DESC) WHERE kind = 'gift_card';

CREATE FUNCTION immutable_notification_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Notification requests are immutable; create a new request' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER notification_request_immutable BEFORE UPDATE ON notification_requests
    FOR EACH ROW EXECUTE FUNCTION immutable_notification_request();

CREATE TABLE document_artifacts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID REFERENCES invoices(id),
    gift_card_id UUID REFERENCES gift_cards(id),
    source_hash TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type IN ('application/pdf', 'image/png')),
    sha256 TEXT NOT NULL,
    byte_length BIGINT NOT NULL CHECK (byte_length > 0),
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(invoice_id, gift_card_id) = 1),
    CHECK ((invoice_id IS NOT NULL AND mime_type = 'application/pdf')
        OR (gift_card_id IS NOT NULL AND mime_type = 'image/png')),
    CHECK (mime_type <> 'image/png' OR byte_length <= 5242880),
    CHECK (mime_type <> 'image/png' OR sha256 ~ '^[0-9a-f]{64}$'),
    UNIQUE (invoice_id, source_hash)
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID REFERENCES invoices(id),
    gift_card_id UUID REFERENCES gift_cards(id),
    kind TEXT NOT NULL CHECK (
        kind IN ('invoice_created', 'invoice_updated', 'invoice_ready', 'manual_resend', 'gift_card')
    ),
    notification_request_id UUID NOT NULL REFERENCES notification_requests(id),
    FOREIGN KEY (notification_request_id, invoice_id) REFERENCES notification_requests(id, invoice_id),
    FOREIGN KEY (notification_request_id, gift_card_id) REFERENCES notification_requests(id, gift_card_id),
    CHECK ((kind = 'gift_card' AND gift_card_id IS NOT NULL AND invoice_id IS NULL)
        OR (kind <> 'gift_card' AND invoice_id IS NOT NULL AND gift_card_id IS NULL)),
    command_id UUID UNIQUE,
    event_key TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    preview_version UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft', 'approved', 'stale', 'cancelled')),
    snapshot JSONB NOT NULL,
    artifact_id UUID REFERENCES document_artifacts(id),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    resend_of UUID REFERENCES notifications(id)
);

CREATE UNIQUE INDEX notifications_active_event
    ON notifications (invoice_id, event_key)
    WHERE state IN ('draft', 'approved');

-- Once approved, a business event cannot be approved again even if its queue
-- later becomes stale or is cancelled. Intentional resends get a new event key.
CREATE UNIQUE INDEX notifications_approved_event
    ON notifications (invoice_id, event_key)
    WHERE approved_at IS NOT NULL;

CREATE INDEX notifications_preview_cleanup
    ON notifications (created_at)
    WHERE approved_at IS NULL;

CREATE INDEX notifications_versions
    ON notifications (invoice_id, source_hash, approved_at DESC, id DESC)
    WHERE approved_at IS NOT NULL;
CREATE INDEX notifications_request_history
    ON notifications(notification_request_id, approved_at DESC, id DESC);
CREATE INDEX notifications_gift_card_history
    ON notifications(gift_card_id, approved_at DESC, id DESC) WHERE gift_card_id IS NOT NULL;

CREATE TABLE notification_recipients (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    normalized_mobile TEXT NOT NULL CHECK (normalized_mobile ~ '^\+[1-9][0-9]{7,14}$'),
    customers JSONB NOT NULL,
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN (
            'draft', 'queued', 'submitting', 'accepted', 'delivered',
            'read', 'failed', 'uncertain', 'cancelled'
        )
    ),
    provider_message_id TEXT UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(notification_id, normalized_mobile)
);

CREATE INDEX notification_delivery_queue
    ON notification_recipients (next_attempt_at)
    WHERE status = 'queued';

CREATE TABLE notification_attempts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    recipient_id UUID NOT NULL REFERENCES notification_recipients(id),
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    outcome TEXT,
    provider_message_id TEXT,
    error_message TEXT,
    UNIQUE(recipient_id, attempt_number)
);

CREATE TABLE whatsapp_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_hash TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_webhook_pending
    ON whatsapp_webhook_events (id)
    WHERE NOT processed;

-- An unapproved manual preview is not a reminder. Only actual notification
-- requests participate, so imported business records cannot create a backlog.
CREATE VIEW notification_current_requests AS
SELECT DISTINCT ON (r.kind, r.invoice_id, r.repair_id, r.gift_card_id) r.*
FROM notification_requests r
WHERE r.origin = 'business'
   OR EXISTS (SELECT 1 FROM notifications n WHERE n.notification_request_id = r.id AND n.approved_at IS NOT NULL)
ORDER BY r.kind, r.invoice_id, r.repair_id, r.gift_card_id, r.requested_at DESC, r.id DESC;
