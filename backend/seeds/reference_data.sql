-- Baseline reference data, loaded after migrations by src/seed.rs.
--
-- This is application bootstrap data rather than schema: migrations stay safe
-- to replay, while every environment still starts with a usable checklist.
-- Staff edits are preserved because only missing rows are inserted.

INSERT INTO order_stages (name, sort_order, requires_delivery) VALUES
    ('order cutting', 1, FALSE),
    ('cutting', 2, FALSE),
    ('stitching', 3, FALSE),
    ('finishing', 4, FALSE),
    ('ironing', 5, FALSE),
    ('checking', 6, FALSE)
ON CONFLICT (name) DO NOTHING;
