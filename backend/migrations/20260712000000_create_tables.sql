CREATE TABLE branch (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL
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
    discount_unit TEXT NOT NULL DEFAULT 'SAR' CHECK (discount_unit IN ('SAR', '%')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0
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
