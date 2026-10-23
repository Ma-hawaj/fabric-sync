ALTER TABLE gift_cards
    ADD COLUMN bought_for TEXT,
    ADD COLUMN recipient_phone TEXT;

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
