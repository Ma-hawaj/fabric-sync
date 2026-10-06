-- EMD is the workbook's per-receipt embroidery choice (numbered designs
-- 1–22 plus named styles like Zik Zak). It rides on the order alongside the
-- other made-to-measure design slots, so it gets the same free-text TEXT
-- column — the fixed option list lives in the frontend picker.
ALTER TABLE orders ADD COLUMN emd TEXT;
