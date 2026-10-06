-- The last workbook measurement columns with no schema home (see
-- DROPPED_MEASUREMENT in scripts/ingest_xlsm.py, now empty). All numeric
-- body measurements, so the same NUMERIC(6, 2) columns as the rest.
ALTER TABLE measurements
    ADD COLUMN cuffling NUMERIC(6, 2),
    ADD COLUMN sleeve_half NUMERIC(6, 2),
    ADD COLUMN button NUMERIC(6, 2),
    ADD COLUMN button_fold NUMERIC(6, 2),
    ADD COLUMN open_fold NUMERIC(6, 2);
