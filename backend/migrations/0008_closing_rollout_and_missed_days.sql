-- One immutable go-live date per branch. Legacy sales do not become a backlog.
CREATE TABLE branch_closing_policies (
    branch_id UUID PRIMARY KEY REFERENCES branch(id),
    starts_on DATE NOT NULL,
    configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    configured_by TEXT NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL
);

-- Preserve the start of controls for branches that already recorded openings.
INSERT INTO branch_closing_policies(branch_id, starts_on, configured_at, configured_by, request_id, request_hash)
SELECT DISTINCT ON (branch_id) branch_id, business_date, recorded_at, recorded_by,
       id, decode(repeat('00', 32), 'hex')
FROM branch_cash_openings ORDER BY branch_id, business_date, recorded_at, id;

-- A separate audit resolution; it never supplies or changes a past cash count.
CREATE TABLE branch_missed_closings (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    business_date DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    resolved_by TEXT NOT NULL,
    report_snapshot JSONB NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL,
    UNIQUE (branch_id, business_date)
);
