-- Legacy imports can preserve an unknown fabric without an inventory record.
ALTER TABLE orders DROP CONSTRAINT orders_material_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_material_source_check
    CHECK (material_source IN ('shop', 'customer', 'unknown'));

ALTER TABLE orders DROP CONSTRAINT orders_material_details_check;
ALTER TABLE orders ADD CONSTRAINT orders_material_details_check CHECK (
    (material_source = 'shop' AND material_id IS NOT NULL AND customer_material_description IS NULL)
    OR
    (material_source = 'customer' AND material_id IS NULL
     AND customer_material_description IS NOT NULL
     AND length(btrim(customer_material_description)) > 0)
    OR
    (material_source = 'unknown' AND material_id IS NULL AND customer_material_description IS NULL)
);
