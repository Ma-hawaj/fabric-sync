-- Credits and money paid back are separate, append-only ledgers. The original
-- sale, its payments, and its stock deductions remain an auditable history.
CREATE TABLE invoice_returns (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    request_id UUID NOT NULL,
    request_payload JSONB NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL,
    UNIQUE (invoice_id, request_id)
);

CREATE TABLE invoice_return_lines (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    return_id UUID NOT NULL REFERENCES invoice_returns(id),
    order_id UUID REFERENCES orders(id),
    item_id UUID REFERENCES invoice_items(id),
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    restocked BOOLEAN NOT NULL,
    CHECK ((order_id IS NULL) <> (item_id IS NULL)),
    CHECK (order_id IS NULL OR (quantity = 1 AND NOT restocked)),
    UNIQUE (return_id, order_id),
    UNIQUE (return_id, item_id)
);

CREATE INDEX invoice_return_lines_order_idx ON invoice_return_lines(order_id);
CREATE INDEX invoice_return_lines_item_idx ON invoice_return_lines(item_id);

CREATE TABLE invoice_refunds (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    request_id UUID NOT NULL,
    request_payload JSONB NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    payment_type TEXT NOT NULL CHECK (payment_type IN ('benefit', 'cash', 'card', 'gift_card')),
    gift_card_id UUID REFERENCES gift_cards(id),
    CHECK ((payment_type = 'gift_card') = (gift_card_id IS NOT NULL)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL,
    UNIQUE (invoice_id, request_id)
);

-- A single definition is shared by invoice lists, order balances, payment
-- validation and refund limits. Keep NUMERIC arithmetic until the API boundary.
CREATE VIEW invoice_balances AS
SELECT base.*,
    GREATEST(net_total - net_gift_card_redeemed - net_amount_paid, 0) AS balance_due,
    GREATEST(net_gift_card_redeemed + net_amount_paid - net_total, 0) AS refund_due,
    CASE
        WHEN net_total <= net_gift_card_redeemed + net_amount_paid THEN 'paid'
        WHEN net_gift_card_redeemed + net_amount_paid = 0 THEN 'unpaid'
        ELSE 'partial'
    END AS payment_status
FROM (
    SELECT i.id AS invoice_id,
        COALESCE(p.paid, 0) AS amount_paid,
        COALESCE(c.credited, 0) AS amount_credited,
        COALESCE(r.cash_refunded, 0) AS cash_refunded,
        COALESCE(r.gift_card_refunded, 0) AS gift_card_refunded,
        i.total_price - COALESCE(c.credited, 0) AS net_total,
        COALESCE(p.paid, 0) - COALESCE(r.cash_refunded, 0) AS net_amount_paid,
        i.gift_card_redeemed - COALESCE(r.gift_card_refunded, 0) AS net_gift_card_redeemed
    FROM invoices i
    LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM invoice_payments GROUP BY invoice_id) p ON p.invoice_id = i.id
    LEFT JOIN (SELECT invoice_id, SUM(amount) AS credited FROM invoice_returns GROUP BY invoice_id) c ON c.invoice_id = i.id
    LEFT JOIN (
        SELECT invoice_id,
            COALESCE(SUM(amount) FILTER (WHERE payment_type <> 'gift_card'), 0) AS cash_refunded,
            COALESCE(SUM(amount) FILTER (WHERE payment_type = 'gift_card'), 0) AS gift_card_refunded
        FROM invoice_refunds GROUP BY invoice_id
    ) r ON r.invoice_id = i.id
) base;
