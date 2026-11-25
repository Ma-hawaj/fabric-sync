-- Pickup notices attach a generated JPEG card to an invoice. The baseline only
-- allows invoice-linked PDFs, so replace that check in a new migration rather
-- than editing one that may already be applied.
DO $$
DECLARE
    old_constraint name;
BEGIN
    FOR old_constraint IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'document_artifacts'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%invoice_id IS NOT NULL%'
           AND pg_get_constraintdef(oid) LIKE '%mime_type%'
    LOOP
        EXECUTE format('ALTER TABLE document_artifacts DROP CONSTRAINT %I', old_constraint);
    END LOOP;
END $$;

ALTER TABLE document_artifacts
    ADD CONSTRAINT document_artifacts_target_mime_check CHECK (
        num_nonnulls(invoice_id, gift_card_id) = 1
        AND (
            (invoice_id IS NOT NULL AND mime_type IN ('application/pdf', 'image/jpeg'))
            OR (gift_card_id IS NOT NULL AND mime_type = 'image/jpeg')
        )
    );
