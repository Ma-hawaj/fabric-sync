-- Baseline reference data, loaded after migrations by src/seed.rs.
--
-- This is application bootstrap data rather than schema: migrations stay safe
-- to replay, while every environment still starts with a usable checklist.
-- Staff edits are preserved because only missing rows are inserted.

INSERT INTO order_stages (name, sort_order, requires_delivery) VALUES
    ('Cutting', 1, FALSE),
    ('Sewing', 2, FALSE),
    ('Finishing', 3, FALSE),
    ('Location delivery', 4, TRUE)
ON CONFLICT (name) DO NOTHING;
