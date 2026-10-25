-- Immutable document previews, approved notifications, delivery attempts, and webhooks.

CREATE TABLE document_artifacts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    source_hash TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    sha256 TEXT NOT NULL,
    byte_length BIGINT NOT NULL CHECK (byte_length > 0),
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (invoice_id, source_hash)
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (
        kind IN ('invoice_created', 'invoice_updated', 'invoice_ready', 'manual_resend')
    ),
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

-- Approved gift card messages and their durable delivery queue.
CREATE TABLE gift_card_deliveries (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
    request_id UUID NOT NULL UNIQUE,
    approved_by TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    normalized_mobile TEXT NOT NULL,
    body TEXT NOT NULL,
    parameters JSONB NOT NULL,
    template_name TEXT NOT NULL,
    language TEXT NOT NULL,
    image_png BYTEA NOT NULL CHECK (octet_length(image_png) BETWEEN 1 AND 5242880),
    image_filename TEXT NOT NULL,
    image_sha256 TEXT NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN
        ('queued', 'sending', 'accepted', 'delivered', 'read', 'failed', 'uncertain', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    provider_message_id TEXT UNIQUE,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX gift_card_delivery_pending ON gift_card_deliveries(gift_card_id)
    WHERE state IN ('queued', 'sending');
CREATE INDEX gift_card_delivery_history ON gift_card_deliveries(gift_card_id, created_at DESC, id DESC);
CREATE INDEX gift_card_delivery_queue ON gift_card_deliveries(available_at) WHERE state = 'queued';
