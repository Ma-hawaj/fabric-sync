ALTER TABLE invoice_items
    DROP CONSTRAINT invoice_items_kind_check,
    DROP CONSTRAINT invoice_items_check,
    ADD COLUMN material_id UUID REFERENCES materials(id),
    ADD COLUMN unit TEXT,
    ADD CONSTRAINT invoice_items_kind_check CHECK (kind IN ('product', 'gift_card', 'material')),
    ADD CONSTRAINT invoice_items_check CHECK (
        (kind = 'product' AND product_id IS NOT NULL AND gift_card_id IS NULL AND material_id IS NULL)
        OR (kind = 'gift_card' AND gift_card_id IS NOT NULL AND product_id IS NULL AND material_id IS NULL)
        OR (kind = 'material' AND material_id IS NOT NULL AND product_id IS NULL
            AND gift_card_id IS NULL AND branch_id IS NOT NULL AND unit IS NOT NULL
            AND quantity > 0 AND unit_price >= 0)
    );
