-- A final close points to the immutable checked snapshot. No reopen operation.
CREATE TABLE branch_day_closures (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    business_date DATE NOT NULL,
    check_id UUID NOT NULL UNIQUE REFERENCES branch_closing_checks(id),
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    closed_by TEXT NOT NULL,
    UNIQUE (branch_id, business_date)
);
