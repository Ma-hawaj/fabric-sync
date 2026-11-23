-- Branch cash controls, audit records and immutable closing reports.
ALTER TABLE branch
    ADD COLUMN daily_check_required BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN daily_check_changed_at TIMESTAMPTZ,
    ADD COLUMN daily_check_changed_by TEXT;

-- A manager may recover a legacy invoice with no known financial branch once.
-- Activity before this timestamp stays unassigned in all closing reports.
ALTER TABLE invoices
    ADD COLUMN financial_branch_assigned_at TIMESTAMPTZ,
    ADD COLUMN financial_branch_assigned_by TEXT,
    ADD COLUMN financial_branch_assignment_reason TEXT,
    ADD COLUMN financial_branch_assignment_request_id UUID UNIQUE,
    ADD CONSTRAINT financial_branch_assignment_complete CHECK (
        (financial_branch_assigned_at IS NULL
         AND financial_branch_assigned_by IS NULL
         AND financial_branch_assignment_reason IS NULL
         AND financial_branch_assignment_request_id IS NULL)
        OR
        (financial_branch_assigned_at IS NOT NULL
         AND financial_branch_assigned_by IS NOT NULL
         AND length(btrim(financial_branch_assigned_by)) > 0
         AND financial_branch_assignment_reason IS NOT NULL
         AND length(btrim(financial_branch_assignment_reason)) BETWEEN 1 AND 1000
         AND financial_branch_assignment_request_id IS NOT NULL
         AND issuing_branch_id IS NOT NULL)
    );

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

-- One permanent closing per branch/day, including the counts and frozen report.
CREATE TABLE branch_day_closures (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    branch_id UUID NOT NULL REFERENCES branch(id),
    business_date DATE NOT NULL,
    counts JSONB NOT NULL,
    comparison JSONB NOT NULL,
    report_snapshot JSONB NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    closed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    closed_by TEXT NOT NULL,
    UNIQUE (branch_id, business_date)
);

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
