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
    UNIQUE(notification_id, normalized_mobile)
);

-- One immutable approved sequence, one unique destination, one delivery per part.
CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    recipient_id UUID NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
    message_index INTEGER NOT NULL CHECK (message_index >= 0 AND message_index < 10),
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
    UNIQUE(recipient_id, message_index)
);

CREATE INDEX notification_delivery_queue
    ON notification_deliveries (next_attempt_at)
    WHERE status = 'queued';

-- Derive a destination's overall result without duplicating mutable queue state.
CREATE VIEW notification_recipient_status AS
SELECT r.id, r.notification_id, r.normalized_mobile, r.customers, r.selected,
       CASE
           WHEN bool_or(d.status = 'uncertain') THEN 'uncertain'
           WHEN bool_or(d.status = 'failed') THEN 'failed'
           WHEN bool_or(d.status = 'cancelled') THEN 'cancelled'
           WHEN bool_or(d.status IN ('queued', 'submitting')) THEN 'queued'
           WHEN bool_and(d.status = 'read') THEN 'read'
           WHEN bool_and(d.status IN ('delivered', 'read')) THEN 'delivered'
           WHEN bool_and(d.status IN ('accepted', 'delivered', 'read')) THEN 'accepted'
           ELSE 'draft'
       END AS status,
       (array_agg(d.error_message ORDER BY d.message_index) FILTER (WHERE d.error_message IS NOT NULL))[1] AS error_message,
       max(d.sent_at) AS sent_at,
       coalesce(jsonb_agg(jsonb_build_object(
           'messageIndex', d.message_index, 'status', d.status,
           'errorMessage', d.error_message, 'sentAt', d.sent_at
       ) ORDER BY d.message_index) FILTER (WHERE d.id IS NOT NULL), '[]'::jsonb) AS messages
  FROM notification_recipients r
  LEFT JOIN notification_deliveries d ON d.recipient_id = r.id
 GROUP BY r.id;

CREATE TABLE notification_attempts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    delivery_id UUID NOT NULL REFERENCES notification_deliveries(id),
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    outcome TEXT,
    provider_message_id TEXT,
    error_message TEXT,
    UNIQUE(delivery_id, attempt_number)
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
