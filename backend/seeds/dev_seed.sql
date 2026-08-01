-- Development seed data. Loaded by src/seed.rs when SEED_DEV_DATA=true, and
-- only into a database with no customers yet — see the guard there.
--
-- Ids are written out rather than left to uuidv7() so rows can reference each
-- other readably. They are shaped like real v7 values (version nibble 7,
-- variant 8) with the 48-bit timestamp prefix ascending per block, so
-- `ORDER BY id DESC` and the short-id display behave the way they do in
-- production. Block layout, in the order the tables are filled:
--
--   0001 branch          0006 product_stock    000b gift_card_redemptions
--   0002 customers       0007 measurements     000c invoice_items
--   0003 materials       0008 invoices         000d order_repairs
--   0004 material_stock  0009 orders           000e order_stage_progress
--   0005 products        000a gift_cards
--
-- order_stages is not seeded here: the four stages ship in the migration so
-- every environment has them, dev or not. Everything below that needs a stage
-- looks it up by name.

-- Deliberately covers all four capability combinations, including a retired
-- location, so the Locations status filter has something to hide and the
-- production/receiving pickers have something to exclude.
INSERT INTO branch (id, name, receives_orders, holds_stock, is_active) VALUES
    ('019a0000-0001-7000-8000-000000000001', 'Riyadh Main Branch', TRUE,  TRUE,  TRUE),
    ('019a0000-0001-7000-8000-000000000002', 'Jeddah Branch',      TRUE,  FALSE, TRUE),
    ('019a0000-0001-7000-8000-000000000003', 'Central Workshop',   FALSE, TRUE,  TRUE),
    ('019a0000-0001-7000-8000-000000000004', 'Dammam Branch',      TRUE,  TRUE,  FALSE);

INSERT INTO customers (id, name, mobile_no) VALUES
    ('019a0000-0002-7000-8000-000000000001', 'Abdullah Al-Otaibi', '0501234567'),
    ('019a0000-0002-7000-8000-000000000002', 'Faisal Al-Harbi',    '0552345678'),
    ('019a0000-0002-7000-8000-000000000003', 'Mohammed Al-Qahtani','0533456789'),
    ('019a0000-0002-7000-8000-000000000004', 'Saleh Al-Dossari',   '0564567890'),
    ('019a0000-0002-7000-8000-000000000005', 'Yousef Al-Shammari', '0595678901'),
    ('019a0000-0002-7000-8000-000000000006', 'Khalid Al-Zahrani',  '0506789012');

INSERT INTO materials (id, name, sku, unit) VALUES
    ('019a0000-0003-7000-8000-000000000001', 'Japanese Cotton',    'JC-100', 'meters'),
    ('019a0000-0003-7000-8000-000000000002', 'Swiss Voile',        'SV-200', 'meters'),
    ('019a0000-0003-7000-8000-000000000003', 'Egyptian Poplin',    'EP-300', 'meters'),
    ('019a0000-0003-7000-8000-000000000004', 'Italian Linen',      'IL-400', 'meters'),
    ('019a0000-0003-7000-8000-000000000005', 'Korean Polyester',   'KP-500', 'meters'),
    ('019a0000-0003-7000-8000-000000000006', 'Premium Wool Blend', 'WB-600', 'meters');

-- Some materials sit at more than one location, which is the case the
-- per-material/location stock table exists for.
INSERT INTO material_stock (id, material_id, branch_id, quantity) VALUES
    ('019a0000-0004-7000-8000-000000000001', '019a0000-0003-7000-8000-000000000001', '019a0000-0001-7000-8000-000000000001', 120.00),
    ('019a0000-0004-7000-8000-000000000002', '019a0000-0003-7000-8000-000000000001', '019a0000-0001-7000-8000-000000000003',  80.00),
    ('019a0000-0004-7000-8000-000000000003', '019a0000-0003-7000-8000-000000000002', '019a0000-0001-7000-8000-000000000003',  64.50),
    ('019a0000-0004-7000-8000-000000000004', '019a0000-0003-7000-8000-000000000003', '019a0000-0001-7000-8000-000000000001',  45.00),
    ('019a0000-0004-7000-8000-000000000005', '019a0000-0003-7000-8000-000000000004', '019a0000-0001-7000-8000-000000000003',  32.25),
    ('019a0000-0004-7000-8000-000000000006', '019a0000-0003-7000-8000-000000000005', '019a0000-0001-7000-8000-000000000001', 210.00),
    ('019a0000-0004-7000-8000-000000000007', '019a0000-0003-7000-8000-000000000005', '019a0000-0001-7000-8000-000000000003',  95.00),
    ('019a0000-0004-7000-8000-000000000008', '019a0000-0003-7000-8000-000000000006', '019a0000-0001-7000-8000-000000000003',  18.00);

INSERT INTO products (id, name, sku, unit_price, is_active) VALUES
    ('019a0000-0005-7000-8000-000000000001', 'Ghutra (Classic White)', 'GH-01', 45.00,  TRUE),
    ('019a0000-0005-7000-8000-000000000002', 'Bisht (Formal Black)',   'BI-01', 850.00, TRUE),
    ('019a0000-0005-7000-8000-000000000003', 'Tailoring Care Kit',     'TK-01', 120.00, TRUE),
    ('019a0000-0005-7000-8000-000000000004', 'Seasonal Scarf',         'SC-01', 60.00,  FALSE);

INSERT INTO product_stock (id, product_id, branch_id, quantity) VALUES
    ('019a0000-0006-7000-8000-000000000001', '019a0000-0005-7000-8000-000000000001', '019a0000-0001-7000-8000-000000000001', 40.00),
    ('019a0000-0006-7000-8000-000000000002', '019a0000-0005-7000-8000-000000000001', '019a0000-0001-7000-8000-000000000002', 25.00),
    ('019a0000-0006-7000-8000-000000000003', '019a0000-0005-7000-8000-000000000002', '019a0000-0001-7000-8000-000000000001',  6.00),
    ('019a0000-0006-7000-8000-000000000004', '019a0000-0005-7000-8000-000000000003', '019a0000-0001-7000-8000-000000000001', 15.00),
    ('019a0000-0006-7000-8000-000000000005', '019a0000-0005-7000-8000-000000000004', '019a0000-0001-7000-8000-000000000001', 12.00);

-- Customers 1 and 3 have two visits each, so the customer query's
-- json_agg(... ORDER BY measurement_date DESC) has more than one row to sort.
INSERT INTO measurements (
    id, customer_id, measurement_date,
    length_fl, length_bl, chest, waist, hips, shoulder, sleeve_length, neck,
    open_hand, cuffling, full_body, chest_up, open_fold, cuff_width,
    neck_width, aram_hole, sleeve_haff_button, button_fold, fo, fo_width,
    frant_pocket_length, farnt_pocket_length_by_width, side_pocket,
    mobile_pocket_length_by_width
) VALUES
    ('019a0000-0007-7000-8000-000000000001', '019a0000-0002-7000-8000-000000000001', CURRENT_DATE - 240,
     146.00, 148.00, 108.00, 98.00, 106.00, 47.50, 62.00, 41.00, 26.00, 'Single', 'Regular', 54.00, 'Open', 12.00, 18.50, 24.00, 'Yes', 'Hidden', 'Round', 8.50, 16.00, '16x14', 'Both', '18x12'),
    ('019a0000-0007-7000-8000-000000000002', '019a0000-0002-7000-8000-000000000001', CURRENT_DATE - 45,
     146.00, 148.00, 110.00, 100.00, 107.00, 48.00, 62.00, 41.50, 26.00, 'Single', 'Regular', 55.00, 'Open', 12.00, 18.50, 24.50, 'Yes', 'Hidden', 'Round', 8.50, 16.00, '16x14', 'Both', '18x12'),
    ('019a0000-0007-7000-8000-000000000003', '019a0000-0002-7000-8000-000000000002', CURRENT_DATE - 90,
     150.00, 152.00, 112.00, 104.00, 110.00, 49.00, 63.50, 42.00, 27.00, 'Double', 'Loose', 56.00, 'Closed', 12.50, 19.00, 25.00, 'No', 'Visible', 'Square', 9.00, 17.00, '17x14', 'Left', '18x12'),
    ('019a0000-0007-7000-8000-000000000004', '019a0000-0002-7000-8000-000000000003', CURRENT_DATE - 180,
     142.00, 144.00, 102.00, 92.00, 100.00, 46.00, 60.00, 39.50, 25.00, 'Single', 'Slim', 52.00, 'Open', 11.50, 17.50, 23.00, 'Yes', 'Hidden', 'Round', 8.00, 15.50, '15x13', 'Right', '17x11'),
    ('019a0000-0007-7000-8000-000000000005', '019a0000-0002-7000-8000-000000000003', CURRENT_DATE - 20,
     142.00, 144.00, 103.00, 93.00, 101.00, 46.00, 60.50, 39.50, 25.00, 'Single', 'Slim', 52.50, 'Open', 11.50, 17.50, 23.00, 'Yes', 'Hidden', 'Round', 8.00, 15.50, '15x13', 'Right', '17x11'),
    ('019a0000-0007-7000-8000-000000000006', '019a0000-0002-7000-8000-000000000004', CURRENT_DATE - 60,
     148.00, 150.00, 114.00, 108.00, 112.00, 50.00, 64.00, 43.00, 27.50, 'Double', 'Loose', 57.00, 'Closed', 13.00, 19.50, 25.50, 'No', 'Visible', 'Square', 9.50, 17.50, '17x15', 'Both', '19x12'),
    ('019a0000-0007-7000-8000-000000000007', '019a0000-0002-7000-8000-000000000005', CURRENT_DATE - 30,
     144.00, 146.00, 106.00, 96.00, 104.00, 47.00, 61.00, 40.50, 25.50, 'Single', 'Regular', 53.00, 'Open', 12.00, 18.00, 23.50, 'Yes', 'Hidden', 'Round', 8.50, 16.00, '16x13', 'Left', '18x11'),
    ('019a0000-0007-7000-8000-000000000008', '019a0000-0002-7000-8000-000000000006', CURRENT_DATE - 10,
     152.00, 154.00, 116.00, 110.00, 114.00, 51.00, 65.00, 44.00, 28.00, 'Double', 'Loose', 58.00, 'Closed', 13.50, 20.00, 26.00, 'No', 'Visible', 'Square', 10.00, 18.00, '18x15', 'Both', '19x13');

-- One invoice per payment state, plus one of each discount unit and a
-- product-only sale that names its buyer directly (no orders to reach a
-- customer through). Totals are VAT-inclusive: 15% applied after the discount.
INSERT INTO invoices (
    id, total_price, invoice_date, branch_id, discount, discount_unit,
    payment_status, amount_paid, advance_amount, advance_payment_type,
    final_payment_type, customer_id, gift_card_redeemed
) VALUES
    -- 830 goods, no discount -> 954.50, nothing paid yet
    ('019a0000-0008-7000-8000-000000000001',  954.50, CURRENT_DATE - 12, '019a0000-0001-7000-8000-000000000001',   0.00, 'amount',  'unpaid',     0.00,    0.00, NULL,      NULL,   NULL, 0.00),
    -- 1420 goods less a 100 discount -> 1518.00, 500 advance taken in cash
    ('019a0000-0008-7000-8000-000000000002', 1518.00, CURRENT_DATE - 10, '019a0000-0001-7000-8000-000000000002', 100.00, 'amount',  'partial',  500.00,  500.00, 'cash',    NULL,   NULL, 0.00),
    -- 1200 goods less 10% -> 1242.00, settled: 400 advance then the balance on card
    ('019a0000-0008-7000-8000-000000000003', 1242.00, CURRENT_DATE - 30, '019a0000-0001-7000-8000-000000000001',  10.00, 'percent', 'paid',    1242.00,  400.00, 'benefit', 'card', NULL, 0.00),
    -- 1050 goods -> 1207.50, 300 advance on card
    ('019a0000-0008-7000-8000-000000000004', 1207.50, CURRENT_DATE - 6,  '019a0000-0001-7000-8000-000000000001',   0.00, 'amount',  'partial',  300.00,  300.00, 'card',    NULL,   NULL, 0.00),
    -- 1400 goods -> 1610.00, part-settled with a gift card rather than a payment
    ('019a0000-0008-7000-8000-000000000005', 1610.00, CURRENT_DATE - 3,  '019a0000-0001-7000-8000-000000000002',   0.00, 'amount',  'partial',    0.00,    0.00, NULL,      NULL,   NULL, 200.00),
    -- Retail only: 90 of goods -> 103.50, plus a 500 gift card sold at face value
    ('019a0000-0008-7000-8000-000000000006',  603.50, CURRENT_DATE - 1,  '019a0000-0001-7000-8000-000000000001',   0.00, 'amount',  'paid',     603.50,    0.00, NULL,      'cash', '019a0000-0002-7000-8000-000000000006', 0.00);

-- production_branch_id is Central Workshop on most orders — a different
-- location from where the customer collects, so the delivery stage applies.
-- Orders 06 and 07 are produced at the branch they are collected from (so the
-- delivery stage is reported as not applicable), and 11 and 12 have no
-- production location assigned yet.
INSERT INTO orders (
    id, measurement_id, material_id, material_amount, invoice_id, price,
    thobe_type, f_pocket, collar, sleeve, patti, more_details,
    status, received_at, production_branch_id
) VALUES
    ('019a0000-0009-7000-8000-000000000001', '019a0000-0007-7000-8000-000000000002', '019a0000-0003-7000-8000-000000000001', 3.50, '019a0000-0008-7000-8000-000000000001', 450.00, 'Saudi',   'Round',  'Classic', 'Cuff',    'Narrow', 'Customer prefers a softer collar.', 'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000002', '019a0000-0007-7000-8000-000000000002', '019a0000-0003-7000-8000-000000000002', 3.25, '019a0000-0008-7000-8000-000000000001', 380.00, 'Saudi',   'Square', 'Classic', 'Cuff',    'Narrow', NULL,                                'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000003', '019a0000-0007-7000-8000-000000000003', '019a0000-0003-7000-8000-000000000003', 4.00, '019a0000-0008-7000-8000-000000000002', 500.00, 'Kuwaiti', 'Round',  'Band',    'Cuff',    'Wide',   NULL,                                'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000004', '019a0000-0007-7000-8000-000000000003', '019a0000-0003-7000-8000-000000000003', 4.00, '019a0000-0008-7000-8000-000000000002', 500.00, 'Kuwaiti', 'Round',  'Band',    'Cuff',    'Wide',   'Second identical thobe.',           'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000005', '019a0000-0007-7000-8000-000000000003', '019a0000-0003-7000-8000-000000000005', 3.75, '019a0000-0008-7000-8000-000000000002', 420.00, 'Emirati', 'Square', 'Classic', 'Plain',   'Narrow', NULL,                                'received', now() - interval '2 days', '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000006', '019a0000-0007-7000-8000-000000000005', '019a0000-0003-7000-8000-000000000004', 4.25, '019a0000-0008-7000-8000-000000000003', 600.00, 'Saudi',   'Round',  'Classic', 'Cuff',    'Wide',   'Linen — press on low heat.',        'received', now() - interval '20 days', '019a0000-0001-7000-8000-000000000001'),
    ('019a0000-0009-7000-8000-000000000007', '019a0000-0007-7000-8000-000000000005', '019a0000-0003-7000-8000-000000000004', 4.25, '019a0000-0008-7000-8000-000000000003', 600.00, 'Saudi',   'Round',  'Classic', 'Cuff',    'Wide',   NULL,                                'received', now() - interval '20 days', '019a0000-0001-7000-8000-000000000001'),
    ('019a0000-0009-7000-8000-000000000008', '019a0000-0007-7000-8000-000000000006', '019a0000-0003-7000-8000-000000000005', 3.00, '019a0000-0008-7000-8000-000000000004', 350.00, 'Omani',   'Round',  'Band',    'Plain',   'Narrow', NULL,                                'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-000000000009', '019a0000-0007-7000-8000-000000000006', '019a0000-0003-7000-8000-000000000005', 3.00, '019a0000-0008-7000-8000-000000000004', 350.00, 'Omani',   'Round',  'Band',    'Plain',   'Narrow', NULL,                                'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-00000000000a', '019a0000-0007-7000-8000-000000000006', '019a0000-0003-7000-8000-000000000001', 3.00, '019a0000-0008-7000-8000-000000000004', 350.00, 'Omani',   'Square', 'Band',    'Plain',   'Narrow', NULL,                                'pending',  NULL,                     '019a0000-0001-7000-8000-000000000003'),
    ('019a0000-0009-7000-8000-00000000000b', '019a0000-0007-7000-8000-000000000007', '019a0000-0003-7000-8000-000000000006', 4.50, '019a0000-0008-7000-8000-000000000005', 700.00, 'Saudi',   'Round',  'Classic', 'Cufflink','Wide',   'Wool blend — winter order.',        'pending',  NULL,                     NULL),
    ('019a0000-0009-7000-8000-00000000000c', '019a0000-0007-7000-8000-000000000007', '019a0000-0003-7000-8000-000000000006', 4.50, '019a0000-0008-7000-8000-000000000005', 700.00, 'Saudi',   'Round',  'Classic', 'Cufflink','Wide',   NULL,                                'pending',  NULL,                     NULL);

INSERT INTO gift_cards (id, code, initial_amount, balance, customer_id, expires_on, is_active) VALUES
    ('019a0000-000a-7000-8000-000000000001', 'GC-ACTIVE-500', 500.00, 300.00, '019a0000-0002-7000-8000-000000000001', CURRENT_DATE + 300, TRUE),
    ('019a0000-000a-7000-8000-000000000002', 'GC-SPENT-250',  250.00,   0.00, '019a0000-0002-7000-8000-000000000002', CURRENT_DATE + 120, TRUE),
    ('019a0000-000a-7000-8000-000000000003', 'GC-NEW-500',    500.00, 500.00, '019a0000-0002-7000-8000-000000000006', CURRENT_DATE + 365, TRUE);

INSERT INTO gift_card_redemptions (id, gift_card_id, invoice_id, amount, redeemed_at) VALUES
    ('019a0000-000b-7000-8000-000000000001', '019a0000-000a-7000-8000-000000000001', '019a0000-0008-7000-8000-000000000005', 200.00, now() - interval '3 days');

INSERT INTO invoice_items (
    id, invoice_id, kind, product_id, gift_card_id, branch_id,
    description, quantity, unit_price, line_total
) VALUES
    ('019a0000-000c-7000-8000-000000000001', '019a0000-0008-7000-8000-000000000006', 'product',   '019a0000-0005-7000-8000-000000000001', NULL, '019a0000-0001-7000-8000-000000000001', 'Ghutra (Classic White)', 2.00,  45.00,  90.00),
    ('019a0000-000c-7000-8000-000000000002', '019a0000-0008-7000-8000-000000000006', 'gift_card', NULL, '019a0000-000a-7000-8000-000000000003', NULL,                                  'Gift card GC-NEW-500',   1.00, 500.00, 500.00);

-- One repair in each status. Order 06 carries two, which is the case the
-- per-repair history exists for: a second return does not overwrite the first.
INSERT INTO order_repairs (id, order_id, reason, reported_on, charge, status, completed_at, notes) VALUES
    ('019a0000-000d-7000-8000-000000000001', '019a0000-0009-7000-8000-000000000006', 'Sleeve length needs shortening',        CURRENT_DATE - 4,   0.00, 'open',        NULL,                       'Customer will collect on Thursday.'),
    ('019a0000-000d-7000-8000-000000000002', '019a0000-0009-7000-8000-000000000006', 'Collar stitching came loose',           CURRENT_DATE - 8,   0.00, 'in_progress', NULL,                       NULL),
    ('019a0000-000d-7000-8000-000000000003', '019a0000-0009-7000-8000-000000000007', 'Customer requested wider cuffs',        CURRENT_DATE - 14, 35.00, 'completed',   now() - interval '5 days',  'Chargeable — a change of mind rather than a fault.'),
    ('019a0000-000d-7000-8000-000000000004', '019a0000-0009-7000-8000-000000000005', 'Reported stain, found to be pre-existing', CURRENT_DATE - 1, 0.00, 'cancelled',   NULL,                       'Nothing to rework.');

-- Only stages actually acted on are stored; everything else is derived as
-- pending. Stages are looked up by name because the migration lets uuidv7()
-- generate their ids.
--
-- The spread is deliberate: order 01 not started, 02 mid-cut, 03 and 04 at
-- Finishing (04 having skipped a stage), 05 fully delivered, 06 finished
-- without a delivery because it never left its branch, 10 waiting on delivery.
INSERT INTO order_stage_progress (order_id, repair_id, stage_id, status, completed_at, location_id, notes)
SELECT v.order_id, v.repair_id, s.id, v.status, v.completed_at, v.location_id, v.notes
FROM (VALUES
    -- Order 02: cutting done, sewing next.
    ('019a0000-0009-7000-8000-000000000002'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '9 days',  NULL::uuid, NULL::text),
    -- Order 03: through sewing, finishing next.
    ('019a0000-0009-7000-8000-000000000003'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '8 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000003'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '5 days',  NULL::uuid, NULL::text),
    -- Order 04: sewing skipped, so finishing is next despite the gap.
    ('019a0000-0009-7000-8000-000000000004'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '8 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000004'::uuid, NULL::uuid, 'Sewing',            'skipped', now() - interval '6 days',  NULL::uuid, 'Reused the panel cut for the matching thobe.'),
    -- Order 05: the full run, including a delivery to the collecting branch.
    ('019a0000-0009-7000-8000-000000000005'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '9 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000005'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '6 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000005'::uuid, NULL::uuid, 'Finishing',         'done',    now() - interval '4 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000005'::uuid, NULL::uuid, 'Location delivery', 'done',    now() - interval '3 days',  '019a0000-0001-7000-8000-000000000002'::uuid, 'Sent with the Wednesday run.'),
    -- Order 06: produced at the branch it is collected from, so it is finished
    -- after Finishing — the delivery stage never applied.
    ('019a0000-0009-7000-8000-000000000006'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '28 days', NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000006'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '25 days', NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000006'::uuid, NULL::uuid, 'Finishing',         'done',    now() - interval '22 days', NULL::uuid, NULL::text),
    -- Order 07: same, and it has a completed repair below.
    ('019a0000-0009-7000-8000-000000000007'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '28 days', NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000007'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '24 days', NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000007'::uuid, NULL::uuid, 'Finishing',         'done',    now() - interval '21 days', NULL::uuid, NULL::text),
    -- Order 09: mid-run.
    ('019a0000-0009-7000-8000-000000000009'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '4 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000009'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '2 days',  NULL::uuid, NULL::text),
    -- Order 10: made, waiting on the move to the collecting branch.
    ('019a0000-0009-7000-8000-00000000000a'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '5 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-00000000000a'::uuid, NULL::uuid, 'Sewing',            'done',    now() - interval '3 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-00000000000a'::uuid, NULL::uuid, 'Finishing',         'done',    now() - interval '1 days',  NULL::uuid, NULL::text),
    -- Order 11: started, no production location assigned yet.
    ('019a0000-0009-7000-8000-00000000000b'::uuid, NULL::uuid, 'Cutting',           'done',    now() - interval '2 days',  NULL::uuid, NULL::text),
    -- Repair 02 (in progress): rework needs no re-cutting.
    ('019a0000-0009-7000-8000-000000000006'::uuid, '019a0000-000d-7000-8000-000000000002'::uuid, 'Cutting', 'skipped', now() - interval '7 days', NULL::uuid, 'Nothing to re-cut.'),
    ('019a0000-0009-7000-8000-000000000006'::uuid, '019a0000-000d-7000-8000-000000000002'::uuid, 'Sewing',  'done',    now() - interval '6 days', NULL::uuid, NULL::text),
    -- Repair 03 (completed): its own full pass, independent of the build's.
    ('019a0000-0009-7000-8000-000000000007'::uuid, '019a0000-000d-7000-8000-000000000003'::uuid, 'Cutting',   'skipped', now() - interval '12 days', NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000007'::uuid, '019a0000-000d-7000-8000-000000000003'::uuid, 'Sewing',    'done',    now() - interval '8 days',  NULL::uuid, NULL::text),
    ('019a0000-0009-7000-8000-000000000007'::uuid, '019a0000-000d-7000-8000-000000000003'::uuid, 'Finishing', 'done',    now() - interval '5 days',  NULL::uuid, NULL::text)
) AS v(order_id, repair_id, stage_name, status, completed_at, location_id, notes)
JOIN order_stages s ON s.name = v.stage_name;
