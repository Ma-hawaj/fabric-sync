-- A seventh order design slot: the side pocket style, alongside the front
-- pocket. Like every other slot it stores the bare catalog slug as TEXT (no
-- foreign key), so legacy free text still prints as a text-only chip — and
-- like every other slot its options live in `design_options`, seeded below
-- as text-only rows (numbers 1–6) until staff upload illustrations.
ALTER TABLE orders ADD COLUMN s_pocket TEXT;

-- The catalog CHECK names its six slots explicitly, so a new slot redeclares
-- it. (The service validates the category too; this is the defense in depth.)
ALTER TABLE design_options DROP CONSTRAINT design_options_category_check;
ALTER TABLE design_options ADD CONSTRAINT design_options_category_check
    CHECK (category IN
        ('thob_type', 'neck', 'sleeve', 'front_pocket', 'side_pocket', 'patti', 'emd'));

INSERT INTO design_options (category, slug, label, sort_order) VALUES
    ('side_pocket', '1', '1', 1),
    ('side_pocket', '2', '2', 2),
    ('side_pocket', '3', '3', 3),
    ('side_pocket', '4', '4', 4),
    ('side_pocket', '5', '5', 5),
    ('side_pocket', '6', '6', 6);
