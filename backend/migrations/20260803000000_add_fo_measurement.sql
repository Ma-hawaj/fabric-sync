-- Fo was a workbook measurement column with no schema home (see
-- DROPPED_MEASUREMENT in scripts/ingest_xlsm.py). It is a numeric body
-- measurement like the rest, so it gets the same NUMERIC(6, 2) column.
ALTER TABLE measurements ADD COLUMN fo NUMERIC(6, 2);
