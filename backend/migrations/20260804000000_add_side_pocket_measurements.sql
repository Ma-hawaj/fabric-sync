-- The side pocket had only a side selector (None / Left / Right / Both)
-- while the front pocket records a length and a length-by-width. Give the
-- side pocket the same two fields, with the same column types.
ALTER TABLE measurements
    ADD COLUMN side_pocket_length NUMERIC(6, 2),
    ADD COLUMN side_pocket_length_by_width TEXT;
