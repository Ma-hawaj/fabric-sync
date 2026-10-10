-- Fabric family for grouping colour variants (see scripts/ingest_storage_csv.py):
-- one material per colour ("Zabrjad 1", "Zabrjad 2", ...) sharing
-- family "Zabrjad", so the inventory table can cluster a fabric's variants
-- behind one filter. Nullable: pre-existing materials simply have no family.
ALTER TABLE materials ADD COLUMN family TEXT;
