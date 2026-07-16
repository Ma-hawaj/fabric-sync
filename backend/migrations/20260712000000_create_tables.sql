CREATE TABLE branch (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    mobile_no TEXT NOT NULL UNIQUE
);

CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    branch_id UUID NOT NULL REFERENCES branch(id)
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0
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
    thobe_type_1 TEXT,
    f_pocket_1 TEXT,
    collar_1 TEXT,
    sleeve_1 TEXT,
    patti_1 TEXT,
    more_details_1 TEXT,
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
    mobile_pocket_length_by_width TEXT,
    thobe_type_2 TEXT,
    f_pocket_2 TEXT,
    collar_2 TEXT,
    sleeve_2 TEXT,
    patti_2 TEXT,
    more_details_2 TEXT,
    thobe_type_3 TEXT,
    f_pocket_3 TEXT,
    collar_3 TEXT,
    sleeve_3 TEXT,
    patti_3 TEXT,
    more_details_3 TEXT
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    measurement_id UUID NOT NULL REFERENCES measurements(id),
    material_id UUID NOT NULL REFERENCES materials(id),
    material_amount NUMERIC(10, 2) NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    price NUMERIC(10, 2) NOT NULL
);
