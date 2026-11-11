-- Marketing consent is destination scoped and independent of utility updates.
CREATE TABLE marketing_consent (
    mobile TEXT PRIMARY KEY CHECK (mobile ~ '^\+[1-9][0-9]{7,14}$'),
    granted BOOLEAN NOT NULL,
    version UUID NOT NULL DEFAULT uuidv7(),
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE marketing_consent_events (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    mobile TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    provider_event_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX marketing_consent_history ON marketing_consent_events(mobile, created_at DESC);

CREATE TABLE campaign_assets (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
    sha256 TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE campaign_templates (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    revision UUID NOT NULL DEFAULT uuidv7(),
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    definition JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',
    provider_id TEXT UNIQUE,
    provider_components JSONB,
    rejection_reason TEXT,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at TIMESTAMPTZ,
    UNIQUE(name, language)
);
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    revision UUID NOT NULL DEFAULT uuidv7(),
    name TEXT NOT NULL,
    definition JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','scheduled','sending','blocked','completed','cancelled','expired')),
    preview_version UUID,
    preview JSONB,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    approval_request_id UUID UNIQUE,
    send_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    blocked_reason TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_due ON campaigns(send_at) WHERE state IN ('scheduled','sending','blocked');
CREATE TABLE campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id),
    mobile TEXT NOT NULL,
    customers JSONB NOT NULL,
    consent_version UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','submitting','accepted','delivered','read','failed','uncertain','skipped','cancelled','expired')),
    provider_message_id TEXT UNIQUE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    request_started BOOLEAN NOT NULL DEFAULT false,
    error_message TEXT,
    unsubscribed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(campaign_id, mobile)
);
CREATE INDEX campaign_queue ON campaign_recipients(available_at) WHERE state = 'queued';
CREATE TABLE campaign_attempts (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    recipient_id UUID NOT NULL REFERENCES campaign_recipients(id),
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    outcome TEXT,
    provider_message_id TEXT,
    error_message TEXT,
    UNIQUE(recipient_id, attempt_number)
);
-- A single row serializes campaign claims and rate-limit reservations across replicas.
CREATE TABLE campaign_dispatch_clock (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    next_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO campaign_dispatch_clock DEFAULT VALUES;
