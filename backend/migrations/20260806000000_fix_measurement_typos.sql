-- The original migration misspelled three measurement columns (the
-- workbook headers they came from are misspelled the same way). Rename
-- them to plain English; nothing else changes.
ALTER TABLE measurements RENAME COLUMN aram_hole TO arm_hole;
ALTER TABLE measurements RENAME COLUMN frant_pocket_length TO front_pocket_length;
ALTER TABLE measurements RENAME COLUMN farnt_pocket_length_by_width TO front_pocket_length_by_width;
