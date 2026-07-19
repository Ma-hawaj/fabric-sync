-- Drop the guardian relationship: mobile_no is required for every customer
-- again, but no longer unique (multiple customers, e.g. family members, may
-- share a phone number).
ALTER TABLE customers DROP COLUMN guardian_id;
ALTER TABLE customers DROP CONSTRAINT customers_mobile_no_key;
ALTER TABLE customers ALTER COLUMN mobile_no SET NOT NULL;
