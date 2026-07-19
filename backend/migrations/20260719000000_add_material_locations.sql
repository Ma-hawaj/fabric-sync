-- A material can be stocked at more than one location (branch), so the
-- single `branch_id` on materials is replaced by a join table tracking
-- quantity per material/location pair.
ALTER TABLE materials
    ADD COLUMN sku TEXT,
    ADD COLUMN unit TEXT NOT NULL DEFAULT 'meters',
    DROP COLUMN branch_id;

CREATE TABLE material_stock (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    material_id UUID NOT NULL REFERENCES materials(id),
    branch_id UUID NOT NULL REFERENCES branch(id),
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 0,
    UNIQUE (material_id, branch_id)
);
