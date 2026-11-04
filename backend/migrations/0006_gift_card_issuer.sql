-- Standalone issuance has no invoice from which to recover the staff identity.
-- Imported rows may have no known issuer; never invent one for those records.
ALTER TABLE gift_cards ADD COLUMN issued_by TEXT
    CHECK (issued_by IS NULL OR BTRIM(issued_by) <> '');
