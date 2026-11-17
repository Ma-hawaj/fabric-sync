ALTER TABLE whatsapp_auto_reply_settings ADD COLUMN button JSONB
    CHECK (button IS NULL OR (
        jsonb_typeof(button) = 'object'
        AND button ?& ARRAY['label', 'url']
        AND jsonb_typeof(button->'label') = 'string'
        AND jsonb_typeof(button->'url') = 'string'
        AND char_length(btrim(button->>'label')) BETWEEN 1 AND 20
        AND char_length(button->>'url') BETWEEN 1 AND 2048
        AND char_length(message) <= 1024
    ));
