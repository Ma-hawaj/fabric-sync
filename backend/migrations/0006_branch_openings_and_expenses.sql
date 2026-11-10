CREATE TABLE branch_cash_openings (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    business_date DATE NOT NULL,
    amount NUMERIC(13, 3) NOT NULL CHECK (amount >= 0),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
    supersedes_id UUID UNIQUE REFERENCES branch_cash_openings(id),
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    recorded_by TEXT NOT NULL
);
CREATE UNIQUE INDEX branch_cash_openings_initial
    ON branch_cash_openings(branch_id, business_date) WHERE supersedes_id IS NULL;
CREATE INDEX branch_cash_openings_day ON branch_cash_openings(branch_id, business_date);

CREATE TABLE branch_expenses (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    business_date DATE NOT NULL,
    amount NUMERIC(13, 3) NOT NULL CHECK (amount > 0),
    payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'benefit', 'card')),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    paid_to TEXT NOT NULL DEFAULT '' CHECK (length(paid_to) <= 200),
    reference TEXT NOT NULL DEFAULT '' CHECK (length(reference) <= 200),
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    recorded_by TEXT NOT NULL
);
CREATE INDEX branch_expenses_day ON branch_expenses(branch_id, business_date, recorded_at, id);

-- A correction preserves the original expense. No edit/delete API is provided.
CREATE TABLE branch_expense_voids (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    expense_id UUID NOT NULL UNIQUE REFERENCES branch_expenses(id),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    recorded_by TEXT NOT NULL
);
