-- A physical location. It can be a branch where customers collect finished
-- orders, a store that only holds material stock, or both — so the two
-- capabilities are independent flags rather than a single type column.
-- Deactivating a location hides it from both pickers without touching the
-- stock rows and invoices that still reference it.
CREATE TABLE branch (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL UNIQUE,
    receives_orders BOOLEAN NOT NULL DEFAULT TRUE,
    holds_stock BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    mobile_no TEXT NOT NULL,
    UNIQUE (name, mobile_no)
);

CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    sku TEXT,
    unit TEXT NOT NULL DEFAULT 'meters'
);

-- A material can be stocked at more than one location (branch), so stock is
-- tracked per material/location pair rather than as a single quantity.
CREATE TABLE material_stock (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    material_id UUID NOT NULL REFERENCES materials(id),
    branch_id UUID NOT NULL REFERENCES branch(id),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
    UNIQUE (material_id, branch_id)
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    branch_id UUID REFERENCES branch(id),
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    discount_unit TEXT NOT NULL DEFAULT 'amount' CHECK (discount_unit IN ('amount', 'percent')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0,
    -- A tailoring invoice finds its customer through orders → measurements, but
    -- a sale of only products or gift cards has no orders to go through. This
    -- names the buyer directly for those; it stays NULL on ordinary invoices.
    customer_id UUID REFERENCES customers(id),
    -- A gift card is tender rather than a discount, so total_price stays the
    -- gross amount charged and this sits alongside amount_paid instead of
    -- reducing the total.
    gift_card_redeemed NUMERIC(10, 2) NOT NULL DEFAULT 0
);

CREATE TABLE measurements (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    measurement_date DATE NOT NULL DEFAULT CURRENT_DATE,

    length_fl NUMERIC(6, 2),
    length_bl NUMERIC(6, 2),
    chest NUMERIC(6, 2),
    waist NUMERIC(6, 2),
    hips NUMERIC(6, 2),
    shoulder NUMERIC(6, 2),
    sleeve_length NUMERIC(6, 2),
    neck NUMERIC(6, 2),
    open_hand NUMERIC(6, 2),
    cuffling TEXT,
    full_body TEXT,
    chest_up NUMERIC(6, 2),
    open_fold TEXT,
    cuff_width NUMERIC(6, 2),
    neck_width NUMERIC(6, 2),
    aram_hole NUMERIC(6, 2),
    sleeve_haff_button TEXT,
    button_fold TEXT,
    fo TEXT,
    fo_width NUMERIC(6, 2),
    frant_pocket_length NUMERIC(6, 2),
    farnt_pocket_length_by_width TEXT,
    side_pocket TEXT,
    mobile_pocket_length_by_width TEXT
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    measurement_id UUID NOT NULL REFERENCES measurements(id),
    material_id UUID NOT NULL REFERENCES materials(id),
    material_amount NUMERIC(10, 2) NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    price NUMERIC(10, 2) NOT NULL,
    thobe_type TEXT,
    f_pocket TEXT,
    collar TEXT,
    sleeve TEXT,
    patti TEXT,
    more_details TEXT
);

-- A finished good sold as-is, as opposed to `materials`, which are raw fabric
-- consumed by a tailoring order. A product carries a list price because it
-- sells at one; an order's price is typed in per line instead. Deactivating a
-- product retires it without disturbing the invoice lines that reference it.
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Mirrors material_stock: a product can sit at more than one location.
CREATE TABLE product_stock (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    product_id UUID NOT NULL REFERENCES products(id),
    branch_id UUID NOT NULL REFERENCES branch(id),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
    UNIQUE (product_id, branch_id)
);

-- Stored value. `balance` is decremented as the card is spent across invoices,
-- so it outlives the sale that created it. The invoice that sold a card is
-- found through invoice_items rather than duplicated here.
CREATE TABLE gift_cards (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    code TEXT NOT NULL UNIQUE,
    initial_amount NUMERIC(10, 2) NOT NULL,
    balance NUMERIC(10, 2) NOT NULL,
    customer_id UUID REFERENCES customers(id),
    expires_on DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Audit trail of every redemption; gift_cards.balance is the running total the
-- redemptions add up to.
CREATE TABLE gift_card_redemptions (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    amount NUMERIC(10, 2) NOT NULL,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A card can only be applied once per invoice; a repeat surfaces as a 409
    -- through the unique-violation mapping in error.rs.
    UNIQUE (gift_card_id, invoice_id)
);

-- Invoice lines that are not tailoring orders. These cannot live in `orders`,
-- whose measurement_id and material_id are NOT NULL and meaningless for a
-- retail sale. branch_id records where a product line's stock came off, and is
-- NULL for a gift card, which has no stock.
CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('product', 'gift_card')),
    product_id UUID REFERENCES products(id),
    gift_card_id UUID REFERENCES gift_cards(id),
    branch_id UUID REFERENCES branch(id),
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(10, 2) NOT NULL,
    line_total NUMERIC(10, 2) NOT NULL,
    CHECK (
        (kind = 'product' AND product_id IS NOT NULL AND gift_card_id IS NULL)
        OR (kind = 'gift_card' AND gift_card_id IS NOT NULL AND product_id IS NULL)
    )
);
