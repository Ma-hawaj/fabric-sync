-- A field-level audit trail of invoice creation and edits. Edits rebuild an
-- invoice's lines, so without this the previous state is unrecoverable; the
-- event row records who changed what and the totals on each side of the edit.
-- Payments, collections, returns and refunds are already immutable ledger rows
-- and are merged into the history read rather than duplicated here.
CREATE TABLE invoice_edit_events (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('created', 'edited')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Authenticated staff subject; NULL for imports and legacy rows.
    actor TEXT,
    -- One entry per changed field: path, human label and the before/after
    -- display values (NULL renders as an empty value).
    changes JSONB NOT NULL DEFAULT '[]',
    total_before NUMERIC(10, 2),
    total_after NUMERIC(10, 2)
);

CREATE INDEX invoice_edit_events_invoice_idx
    ON invoice_edit_events(invoice_id, occurred_at DESC);
