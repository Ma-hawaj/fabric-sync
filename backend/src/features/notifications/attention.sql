WITH current_requests AS (
    SELECT * FROM notification_current_requests
), customers_by_invoice AS (
    SELECT invoice_id,
           jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mobileNo', mobile_no) ORDER BY name, id) AS customers,
           string_agg(name, ', ' ORDER BY name, id) AS customer_name,
           string_agg(mobile_no, ', ' ORDER BY name, id) AS customer_mobile,
           bool_or(whatsapp_notifications_enabled) AS enabled
    FROM (
        SELECT i.id AS invoice_id, c.id, c.name, c.mobile_no, c.whatsapp_notifications_enabled
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.id IN (SELECT invoice_id FROM current_requests)
        UNION
        SELECT o.invoice_id, c.id, c.name, c.mobile_no, c.whatsapp_notifications_enabled
        FROM orders o JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        WHERE o.invoice_id IN (SELECT invoice_id FROM current_requests)
    ) customers
    GROUP BY invoice_id
), contexts AS (
    SELECT request.id AS request_id, request.requested_at, request.kind,
           i.id AS entity_id, i.id AS invoice_id, i.invoice_number,
           'INV-' || i.invoice_number::text AS reference, b.name AS branch_name,
           NULL::uuid AS repair_id, NULL::uuid AS order_id, NULL::text AS repair_reason,
           NULL::uuid AS gift_card_id, NULL::text AS gift_card_code,
           coalesce(c.customers, '[]'::jsonb) AS customers, c.customer_name, c.customer_mobile,
           coalesce(c.enabled, false) AND (request.kind = 'invoice' OR
               (i.collection_method = 'pickup' AND readiness.readiness_status = 'ready')) AS eligible
    FROM current_requests request
    JOIN invoices i ON i.id = request.invoice_id
    JOIN invoice_readiness readiness ON readiness.invoice_id = i.id
    LEFT JOIN branch b ON b.id = i.branch_id
    LEFT JOIN customers_by_invoice c ON c.invoice_id = i.id
    WHERE request.kind IN ('invoice', 'invoice_ready')
    UNION ALL
    SELECT request.id, request.requested_at, request.kind,
           r.id, i.id, i.invoice_number, 'ORD-' || o.order_number::text || ' repair', b.name,
           r.id, o.id, r.reason, NULL::uuid, NULL::text,
           jsonb_build_array(jsonb_build_object('id', c.id, 'name', c.name, 'mobileNo', c.mobile_no)),
           c.name, c.mobile_no,
           c.whatsapp_notifications_enabled AND oc.outcome = 'active'
               AND r.status = 'completed' AND r.completed_at IS NOT NULL AND b.name IS NOT NULL
    FROM current_requests request
    JOIN order_repairs r ON r.id = request.repair_id
    JOIN orders o ON o.id = r.order_id
    JOIN order_outcomes oc ON oc.order_id = o.id
    JOIN invoices i ON i.id = request.invoice_id AND i.id = o.invoice_id
    JOIN measurements m ON m.id = o.measurement_id
    JOIN customers c ON c.id = m.customer_id
    LEFT JOIN branch b ON b.id = i.branch_id
    WHERE request.kind = 'repair_ready'
    UNION ALL
    SELECT request.id, request.requested_at, request.kind,
           g.id, sale.id, sale.invoice_number, g.code, sale.branch_name,
           NULL::uuid, NULL::uuid, NULL::text, g.id, g.code,
           jsonb_build_array(jsonb_build_object('id', g.id,
               'name', coalesce(nullif(btrim(g.bought_for), ''), 'Gift card recipient'),
               'mobileNo', coalesce(g.recipient_phone, ''))),
           coalesce(nullif(btrim(g.bought_for), ''), 'Gift card recipient'), coalesce(g.recipient_phone, ''),
           g.is_active AND g.balance > 0 AND (g.expires_on IS NULL OR g.expires_on >= CURRENT_DATE)
    FROM current_requests request
    JOIN gift_cards g ON g.id = request.gift_card_id
    LEFT JOIN LATERAL (
        SELECT i.id, i.invoice_number, b.name AS branch_name
        FROM invoice_items item JOIN invoices i ON i.id = item.invoice_id
        LEFT JOIN branch b ON b.id = i.branch_id
        WHERE item.gift_card_id = gift_card_original_id(g.id) AND item.kind = 'gift_card'
        ORDER BY item.id LIMIT 1
    ) sale ON true
    WHERE request.kind = 'gift_card'
), latest_sends AS (
    SELECT DISTINCT ON (request_id) request_id, id AS notification_id, approved_at
    FROM (
        SELECT notification_request_id AS request_id, id, approved_at FROM notifications WHERE approved_at IS NOT NULL
        UNION ALL
        SELECT notification_request_id, id, created_at FROM gift_card_deliveries
    ) sends
    ORDER BY request_id, approved_at DESC, id DESC
), recipient_results AS (
    -- An invoice resend replaces only its selected destinations. Gift cards
    -- have a single recipient, so their latest send replaces the earlier one.
    SELECT DISTINCT ON (n.notification_request_id, r.normalized_mobile)
           n.notification_request_id AS request_id, r.id, r.normalized_mobile,
           r.customers, r.status, r.error_message, n.approved_at
    FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id AND r.selected
    WHERE n.approved_at IS NOT NULL
    ORDER BY n.notification_request_id, r.normalized_mobile, n.approved_at DESC, n.id DESC
), gift_card_results AS (
    SELECT DISTINCT ON (d.notification_request_id)
           d.notification_request_id AS request_id, d.id, d.normalized_mobile,
           jsonb_build_array(jsonb_build_object('id', g.id,
               'name', coalesce(d.parameters->>0, nullif(btrim(g.bought_for), ''), 'Gift card recipient'),
               'mobileNo', d.normalized_mobile, 'enabled', true)) AS customers,
           CASE WHEN d.state = 'sending' THEN 'submitting' ELSE d.state END AS status,
           d.last_error AS error_message, d.created_at AS approved_at
    FROM gift_card_deliveries d JOIN gift_cards g ON g.id = d.gift_card_id
    ORDER BY d.notification_request_id, d.created_at DESC, d.id DESC
), request_results AS (
    SELECT latest.request_id, latest.notification_id, latest.approved_at,
           count(r.id) AS recipient_count,
           count(r.id) FILTER (WHERE r.status IN ('queued', 'submitting')) AS queued_count,
           count(r.id) FILTER (WHERE r.status = 'accepted') AS accepted_count,
           count(r.id) FILTER (WHERE r.status IN ('delivered', 'read')) AS delivered_count,
           count(r.id) FILTER (WHERE r.status = 'failed') AS failed_count,
           count(r.id) FILTER (WHERE r.status = 'uncertain') AS uncertain_count,
           count(r.id) FILTER (WHERE r.status = 'cancelled') AS cancelled_count,
           min(r.approved_at) FILTER (WHERE r.status IN ('queued', 'submitting')) AS queued_since,
           min(r.approved_at) FILTER (WHERE r.status IN ('queued', 'submitting', 'failed', 'uncertain', 'cancelled')) AS awaiting_since,
           coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'normalizedMobile', r.normalized_mobile,
               'customers', r.customers, 'selected', true, 'status', r.status, 'errorMessage', r.error_message)
               ORDER BY r.normalized_mobile) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS recipients,
           string_agg(DISTINCT r.error_message, ' · ') FILTER
               (WHERE r.status IN ('failed', 'uncertain', 'cancelled')) AS error_message
    FROM latest_sends latest
    LEFT JOIN (SELECT * FROM recipient_results UNION ALL SELECT * FROM gift_card_results) r ON r.request_id = latest.request_id
    GROUP BY latest.request_id, latest.notification_id, latest.approved_at
), outcomes AS (
    SELECT *, CASE
        WHEN uncertain_count > 0 THEN 'uncertain'
        WHEN failed_count > 0 THEN 'failed'
        WHEN cancelled_count > 0 THEN 'not_sent'
        WHEN queued_count > 0 AND queued_since < now() - interval '30 minutes' THEN 'delayed'
        WHEN queued_count > 0 THEN 'queued'
        WHEN accepted_count > 0 THEN 'accepted'
        WHEN delivered_count > 0 THEN 'delivered'
        ELSE 'not_sent' END AS status
    FROM request_results
), chosen_results AS (
    SELECT current.id AS current_request_id, chosen.*
    FROM current_requests current
    LEFT JOIN LATERAL (
        SELECT result.* FROM outcomes result
        JOIN notification_requests earlier ON earlier.id = result.request_id
        WHERE earlier.kind = current.kind
          AND earlier.invoice_id IS NOT DISTINCT FROM current.invoice_id
          AND earlier.repair_id IS NOT DISTINCT FROM current.repair_id
          AND earlier.gift_card_id IS NOT DISTINCT FROM current.gift_card_id
        ORDER BY (earlier.id = current.id) DESC, earlier.requested_at DESC, earlier.id DESC LIMIT 1
    ) chosen ON true
), attention AS (
    SELECT c.entity_id, c.reference, c.invoice_id, c.invoice_number, c.branch_name,
           c.gift_card_id, c.gift_card_code, c.repair_id, c.order_id, c.repair_reason,
           c.customers, c.customer_name, c.customer_mobile, c.kind, c.eligible,
           r.notification_id, r.approved_at AS last_attempt_at,
           CASE WHEN r.request_id = c.request_id THEN coalesce(r.awaiting_since, r.approved_at, c.requested_at)
               ELSE c.requested_at END AS waiting_since,
           CASE WHEN r.request_id = c.request_id THEN r.status ELSE 'not_sent' END AS status,
           CASE WHEN r.request_id = c.request_id THEN r.recipient_count ELSE 0 END AS recipient_count,
           CASE WHEN r.request_id = c.request_id THEN r.queued_count ELSE 0 END AS queued_count,
           CASE WHEN r.request_id = c.request_id THEN r.accepted_count ELSE 0 END AS accepted_count,
           CASE WHEN r.request_id = c.request_id THEN r.delivered_count ELSE 0 END AS delivered_count,
           CASE WHEN r.request_id = c.request_id THEN r.failed_count ELSE 0 END AS failed_count,
           CASE WHEN r.request_id = c.request_id THEN r.uncertain_count ELSE 0 END AS uncertain_count,
           CASE WHEN r.request_id = c.request_id THEN r.cancelled_count ELSE 0 END AS cancelled_count,
           CASE WHEN r.request_id = c.request_id THEN r.recipients ELSE '[]'::jsonb END AS recipients,
           CASE WHEN r.request_id = c.request_id THEN r.error_message END AS error_message,
           CASE WHEN r.request_id <> c.request_id THEN jsonb_build_object('status', r.status,
               'recipients', r.recipients, 'errorMessage', r.error_message)
               ELSE 'null'::jsonb END AS previous_version
    FROM contexts c LEFT JOIN chosen_results r ON r.current_request_id = c.request_id
    WHERE c.eligible OR r.notification_id IS NOT NULL
)
SELECT *, eligible AND status IN ('not_sent', 'failed', 'uncertain', 'delayed') AS needs_attention
FROM attention
