-- Each check preserves what staff counted and the recorded figures they
-- compared it with. Rechecks append a new record; they never rewrite history.
CREATE TABLE branch_closing_checks (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    report_date DATE NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    report_fingerprint TEXT NOT NULL,
    counts JSONB NOT NULL,
    comparison JSONB NOT NULL,
    report_snapshot JSONB NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_by TEXT NOT NULL
);

CREATE INDEX branch_closing_checks_latest
    ON branch_closing_checks(branch_id, report_date, checked_at DESC, id DESC);
