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
-- A single row serializes campaign claims and rate-limit reservations across replicas.
CREATE TABLE campaign_dispatch_clock (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    next_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO campaign_dispatch_clock DEFAULT VALUES;


-- Campaign approvals use the same request -> send -> recipient -> attempt model.
ALTER TABLE notification_requests ADD COLUMN campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE notification_requests DROP CONSTRAINT notification_requests_kind_check;
ALTER TABLE notification_requests DROP CONSTRAINT notification_requests_check;
ALTER TABLE notification_requests ADD CONSTRAINT notification_requests_kind_check
    CHECK (kind IN ('invoice','invoice_ready','repair_ready','gift_card','campaign'));
ALTER TABLE notification_requests ADD CONSTRAINT notification_requests_check CHECK (
    (kind IN ('invoice','invoice_ready') AND invoice_id IS NOT NULL AND repair_id IS NULL AND gift_card_id IS NULL AND campaign_id IS NULL)
    OR (kind='repair_ready' AND invoice_id IS NOT NULL AND repair_id IS NOT NULL AND gift_card_id IS NULL AND campaign_id IS NULL)
    OR (kind='gift_card' AND invoice_id IS NULL AND repair_id IS NULL AND gift_card_id IS NOT NULL AND campaign_id IS NULL)
    OR (kind='campaign' AND invoice_id IS NULL AND repair_id IS NULL AND gift_card_id IS NULL AND campaign_id IS NOT NULL)
);
ALTER TABLE notification_requests ADD UNIQUE(id,campaign_id);
CREATE UNIQUE INDEX notification_request_campaign ON notification_requests(campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE notifications ADD COLUMN campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications DROP CONSTRAINT notifications_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('invoice_created','invoice_updated','invoice_ready','manual_resend','gift_card','campaign'));
ALTER TABLE notifications ADD CONSTRAINT notifications_check CHECK (
    (kind='campaign' AND campaign_id IS NOT NULL AND invoice_id IS NULL AND gift_card_id IS NULL)
    OR (kind='gift_card' AND gift_card_id IS NOT NULL AND invoice_id IS NULL AND campaign_id IS NULL)
    OR (kind NOT IN ('gift_card','campaign') AND invoice_id IS NOT NULL AND gift_card_id IS NULL AND campaign_id IS NULL)
);
ALTER TABLE notifications ADD FOREIGN KEY(notification_request_id,campaign_id) REFERENCES notification_requests(id,campaign_id);
CREATE UNIQUE INDEX notifications_campaign_send ON notifications(campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE document_artifacts ADD COLUMN campaign_id UUID REFERENCES campaigns(id);
ALTER TABLE document_artifacts DROP CONSTRAINT document_artifacts_mime_type_check;
ALTER TABLE document_artifacts DROP CONSTRAINT document_artifacts_check;
ALTER TABLE document_artifacts DROP CONSTRAINT document_artifacts_check1;
ALTER TABLE document_artifacts ADD CONSTRAINT document_artifacts_mime_type_check CHECK (mime_type IN ('application/pdf','image/png','image/jpeg'));
ALTER TABLE document_artifacts ADD CONSTRAINT document_artifacts_target_check CHECK (
    num_nonnulls(invoice_id,gift_card_id,campaign_id)=1 AND (
        (invoice_id IS NOT NULL AND mime_type='application/pdf')
        OR (gift_card_id IS NOT NULL AND mime_type='image/png')
        OR (campaign_id IS NOT NULL AND mime_type IN ('image/png','image/jpeg') AND byte_length <= 5242880)
    )
);

ALTER TABLE notification_recipients ADD COLUMN marketing_consent_version UUID;
ALTER TABLE notification_recipients ADD COLUMN unsubscribed_at TIMESTAMPTZ;
ALTER TABLE notification_recipients DROP CONSTRAINT notification_recipients_status_check;
ALTER TABLE notification_recipients ADD CONSTRAINT notification_recipients_status_check CHECK (
    status IN ('draft','queued','submitting','accepted','delivered','read','failed','uncertain','cancelled','skipped','expired')
);

-- Marketing stays in campaign reporting, outside the critical attention queue.
CREATE OR REPLACE VIEW notification_current_requests AS
SELECT DISTINCT ON (r.kind,r.invoice_id,r.repair_id,r.gift_card_id)
    r.id,r.invoice_id,r.kind,r.repair_id,r.gift_card_id,r.origin,r.requested_at
FROM notification_requests r
WHERE r.kind <> 'campaign' AND (r.origin='business'
    OR EXISTS(SELECT 1 FROM notifications n WHERE n.notification_request_id=r.id AND n.approved_at IS NOT NULL))
ORDER BY r.kind,r.invoice_id,r.repair_id,r.gift_card_id,r.requested_at DESC,r.id DESC;
