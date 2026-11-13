WITH customers_by_invoice AS (
    SELECT invoice_id,
           jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mobileNo', mobile_no)
                     ORDER BY name, id) AS customers,
           string_agg(name, ', ' ORDER BY name, id) AS customer_name,
           string_agg(mobile_no, ', ' ORDER BY name, id) AS customer_mobile,
           bool_or(whatsapp_notifications_enabled) AS enabled
    FROM (
        SELECT i.id AS invoice_id, c.id, c.name, c.mobile_no, c.whatsapp_notifications_enabled
        FROM invoices i JOIN customers c ON c.id = i.customer_id
        UNION
        SELECT o.invoice_id, c.id, c.name, c.mobile_no, c.whatsapp_notifications_enabled
        FROM orders o JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
    ) customers
    GROUP BY invoice_id
), latest AS (
    SELECT DISTINCT ON (invoice_id, (kind = 'invoice_ready'), coalesce(snapshot->>'repairId', ''))
           id, invoice_id, kind, approved_at, snapshot, event_key, source_hash,
           snapshot->>'repairId' AS repair_id
    FROM notifications
    WHERE approved_at IS NOT NULL
    ORDER BY invoice_id, (kind = 'invoice_ready'), coalesce(snapshot->>'repairId', ''), approved_at DESC, id DESC
), context AS (
    SELECT i.id AS invoice_id, i.invoice_number, i.created_at,
           i.readiness_generation, i.collection_method, b.name AS branch_name,
           c.customers, c.customer_name, c.customer_mobile, coalesce(c.enabled, false) AS enabled,
           readiness.readiness_status,
           ready.waiting_since AS ready_since,
           kind.kind, i.id AS entity_id, 'INV-' || i.invoice_number::text AS reference,
           NULL::uuid AS repair_id, NULL::uuid AS order_id, NULL::text AS repair_reason,
           request.id AS request_id, request.requested_at
    FROM invoices i
    JOIN invoice_readiness readiness ON readiness.invoice_id = i.id
    LEFT JOIN branch b ON b.id = i.branch_id
    LEFT JOIN customers_by_invoice c ON c.invoice_id = i.id
    LEFT JOIN LATERAL (
        SELECT max(o.ready_at) AS waiting_since
        FROM orders o WHERE o.invoice_id = i.id AND o.status = 'ready'
          AND NOT EXISTS (SELECT 1 FROM invoice_return_lines l WHERE l.order_id = o.id)
    ) ready ON true
    CROSS JOIN (VALUES ('invoice'), ('invoice_ready')) kind(kind)
    LEFT JOIN notification_requests request ON request.invoice_id = i.id
        AND request.kind = kind.kind AND request.repair_id IS NULL
), repair_context AS (
    SELECT i.id AS invoice_id, i.invoice_number, i.created_at,
           i.readiness_generation, i.collection_method, b.name AS branch_name,
           jsonb_build_array(jsonb_build_object('id', c.id, 'name', c.name, 'mobileNo', c.mobile_no)) AS customers,
           c.name AS customer_name, c.mobile_no AS customer_mobile,
           c.whatsapp_notifications_enabled AND oc.outcome = 'active' AS enabled,
           CASE WHEN r.status = 'completed' THEN 'ready' ELSE r.status END AS readiness_status,
           r.completed_at AS ready_since, 'repair_ready' AS kind,
           r.id AS entity_id, 'ORD-' || o.order_number::text || ' repair' AS reference,
           r.id AS repair_id, o.id AS order_id, r.reason AS repair_reason,
           request.id AS request_id, request.requested_at
    FROM order_repairs r
    JOIN orders o ON o.id = r.order_id
    JOIN order_outcomes oc ON oc.order_id = o.id
    JOIN invoices i ON i.id = o.invoice_id
    JOIN measurements m ON m.id = o.measurement_id
    JOIN customers c ON c.id = m.customer_id
    LEFT JOIN branch b ON b.id = i.branch_id
    LEFT JOIN notification_requests request ON request.invoice_id = i.id
        AND request.kind = 'repair_ready' AND request.repair_id = r.id
    WHERE r.status = 'completed' OR EXISTS (
        SELECT 1 FROM latest n WHERE n.invoice_id = i.id AND n.repair_id = r.id::text
    )
), contexts AS (
    SELECT * FROM context
    UNION ALL
    SELECT * FROM repair_context
), version_results AS (
    SELECT c.entity_id, c.reference, c.repair_id, c.order_id, c.repair_reason,
           c.invoice_id, c.invoice_number, c.branch_name, c.customer_name, c.customer_mobile,
           coalesce(c.customers, '[]'::jsonb) AS customers, c.kind,
           n.id AS notification_id, n.approved_at AS last_attempt_at,
           cycle.current_generation AND (c.request_id IS NULL OR coalesce(
               n.snapshot->>'attentionEventId' = c.request_id::text, false
           )) AS current_version,
           (c.enabled AND (c.request_id IS NOT NULL OR n.id IS NOT NULL) AND (c.kind = 'invoice' OR
             (c.kind = 'repair_ready' AND c.readiness_status = 'ready' AND c.ready_since IS NOT NULL AND c.branch_name IS NOT NULL) OR
             (c.kind = 'invoice_ready' AND c.collection_method = 'pickup' AND c.readiness_status = 'ready'))) AS eligible,
           CASE WHEN c.kind IN ('invoice_ready', 'repair_ready') THEN coalesce(c.ready_since, n.approved_at, c.created_at)
                ELSE CASE WHEN c.request_id IS NOT NULL AND
                    n.snapshot->>'attentionEventId' IS DISTINCT FROM c.request_id::text
                    THEN c.requested_at
                    ELSE coalesce(r.awaiting_since, n.approved_at, c.requested_at, c.created_at) END
           END AS waiting_since,
           coalesce(r.recipient_count, 0) AS recipient_count,
           coalesce(r.queued_count, 0) AS queued_count,
           coalesce(r.accepted_count, 0) AS accepted_count,
           coalesce(r.delivered_count, 0) AS delivered_count,
           coalesce(r.failed_count, 0) AS failed_count,
           coalesce(r.uncertain_count, 0) AS uncertain_count,
           coalesce(r.cancelled_count, 0) AS cancelled_count,
           coalesce(r.recipients, '[]'::jsonb) AS recipients,
           r.error_message,
           CASE
             WHEN coalesce(r.uncertain_count, 0) > 0 THEN 'uncertain'
             WHEN coalesce(r.failed_count, 0) > 0 THEN 'failed'
             WHEN coalesce(r.cancelled_count, 0) > 0 THEN 'not_sent'
             WHEN coalesce(r.queued_count, 0) > 0 AND r.queued_since < now() - interval '30 minutes' THEN 'delayed'
             WHEN coalesce(r.queued_count, 0) > 0 THEN 'queued'
             WHEN coalesce(r.accepted_count, 0) > 0 THEN 'accepted'
             WHEN coalesce(r.delivered_count, 0) > 0 THEN 'delivered'
             ELSE 'not_sent'
           END AS status
    FROM contexts c
    LEFT JOIN latest n ON n.invoice_id = c.invoice_id
        AND (n.kind = 'invoice_ready') = (c.kind IN ('invoice_ready', 'repair_ready'))
        AND n.repair_id IS NOT DISTINCT FROM c.repair_id::text
    CROSS JOIN LATERAL (
        SELECT CASE WHEN c.kind = 'repair_ready' THEN coalesce(n.approved_at >= c.ready_since, false)
        ELSE c.kind <> 'invoice_ready' OR c.readiness_status <> 'ready' OR coalesce(
            (n.snapshot->>'readinessGeneration')::bigint = c.readiness_generation,
            n.event_key = 'ready:' || c.readiness_generation::text
                OR n.approved_at >= c.ready_since, false) END AS current_generation
    ) cycle
    LEFT JOIN LATERAL (
        SELECT count(*) AS recipient_count,
               count(*) FILTER (WHERE status IN ('queued', 'submitting')) AS queued_count,
               count(*) FILTER (WHERE status = 'accepted') AS accepted_count,
               count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered_count,
               count(*) FILTER (WHERE status = 'failed') AS failed_count,
               count(*) FILTER (WHERE status = 'uncertain') AS uncertain_count,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
               min(latest_approved_at) FILTER (WHERE status IN ('queued', 'submitting')) AS queued_since,
               min(latest_approved_at) FILTER (WHERE status IN
                   ('queued', 'submitting', 'failed', 'uncertain', 'cancelled')) AS awaiting_since,
               jsonb_agg(jsonb_build_object('id', id, 'normalizedMobile', normalized_mobile,
                   'customers', customers, 'selected', true, 'status', status,
                   'errorMessage', error_message) ORDER BY normalized_mobile) AS recipients,
               string_agg(DISTINCT error_message, ' · ') FILTER
                 (WHERE status IN ('failed', 'uncertain', 'cancelled')) AS error_message
        FROM (
            -- A selective resend only supersedes the destinations selected in
            -- that send. Keep unresolved results for every other destination.
            SELECT DISTINCT ON (r.normalized_mobile) r.*, sends.approved_at AS latest_approved_at
            FROM notifications sends
            JOIN notification_recipients r ON r.notification_id = sends.id AND r.selected
            WHERE sends.invoice_id = c.invoice_id AND sends.approved_at IS NOT NULL
              AND (sends.kind = 'invoice_ready') = (c.kind IN ('invoice_ready', 'repair_ready'))
              AND sends.snapshot->>'repairId' IS NOT DISTINCT FROM c.repair_id::text
              AND CASE WHEN n.snapshot->>'attentionEventId' IS NOT NULL THEN
                  sends.snapshot->>'attentionEventId' = n.snapshot->>'attentionEventId'
                  ELSE sends.source_hash = n.source_hash END
            ORDER BY r.normalized_mobile, sends.approved_at DESC, sends.id DESC
        ) destinations
    ) r ON true
    WHERE n.id IS NOT NULL OR (c.request_id IS NOT NULL AND c.enabled AND
        (c.kind = 'invoice' OR
         (c.kind = 'repair_ready' AND c.readiness_status = 'ready' AND c.ready_since IS NOT NULL AND c.branch_name IS NOT NULL) OR
         (c.kind = 'invoice_ready' AND c.collection_method = 'pickup' AND c.readiness_status = 'ready')))
), outcomes AS (
    SELECT entity_id, reference, repair_id, order_id, repair_reason,
           invoice_id, invoice_number, branch_name, customer_name, customer_mobile,
           customers, kind, notification_id, last_attempt_at, eligible, waiting_since,
           CASE WHEN current_version THEN recipient_count ELSE 0 END AS recipient_count,
           CASE WHEN current_version THEN queued_count ELSE 0 END AS queued_count,
           CASE WHEN current_version THEN accepted_count ELSE 0 END AS accepted_count,
           CASE WHEN current_version THEN delivered_count ELSE 0 END AS delivered_count,
           CASE WHEN current_version THEN failed_count ELSE 0 END AS failed_count,
           CASE WHEN current_version THEN uncertain_count ELSE 0 END AS uncertain_count,
           CASE WHEN current_version THEN cancelled_count ELSE 0 END AS cancelled_count,
           CASE WHEN current_version THEN recipients ELSE '[]'::jsonb END AS recipients,
           CASE WHEN current_version THEN error_message END AS error_message,
           CASE WHEN current_version THEN status ELSE 'not_sent' END AS status,
           CASE WHEN NOT current_version AND notification_id IS NOT NULL THEN
               jsonb_build_object('status', status, 'recipients', recipients,
                   'errorMessage', error_message)
               ELSE 'null'::jsonb END AS previous_version
    FROM version_results
), gift_card_context AS (
    SELECT g.id AS entity_id, sale.id AS invoice_id, sale.invoice_number,
           sale.branch_name, g.code AS reference, g.id AS gift_card_id,
           g.code AS gift_card_code,
           coalesce(nullif(btrim(g.bought_for), ''), 'Gift card recipient') AS customer_name,
           coalesce(g.recipient_phone, '') AS customer_mobile,
           jsonb_build_array(jsonb_build_object('id', g.id,
               'name', coalesce(nullif(btrim(g.bought_for), ''), 'Gift card recipient'),
               'mobileNo', coalesce(g.recipient_phone, ''), 'enabled', true)) AS customers,
           d.id AS notification_id, d.created_at AS last_attempt_at,
           coalesce(d.created_at, sale.created_at, uuid_extract_timestamp(g.id), now()) AS waiting_since,
           g.is_active AND g.balance > 0 AND (g.expires_on IS NULL OR g.expires_on >= CURRENT_DATE) AS eligible,
           d.state AS delivery_state, d.normalized_mobile, d.last_error AS error_message,
           CASE WHEN d.state IS NULL OR d.state = 'cancelled' THEN 'not_sent'
                WHEN d.state IN ('queued', 'sending') AND d.created_at < now() - interval '30 minutes' THEN 'delayed'
                WHEN d.state = 'sending' THEN 'queued'
                WHEN d.state = 'read' THEN 'delivered'
                ELSE d.state END AS status
    FROM gift_cards g
    LEFT JOIN LATERAL (
        SELECT id, state, created_at, normalized_mobile, last_error
        FROM gift_card_deliveries WHERE gift_card_id = g.id
        ORDER BY created_at DESC, id DESC LIMIT 1
    ) d ON true
    LEFT JOIN LATERAL (
        SELECT i.id, i.invoice_number, i.created_at, b.name AS branch_name
        FROM invoice_items item JOIN invoices i ON i.id = item.invoice_id
        LEFT JOIN branch b ON b.id = i.branch_id
        WHERE item.gift_card_id = gift_card_original_id(g.id) AND item.kind = 'gift_card'
        ORDER BY item.id LIMIT 1
    ) sale ON true
), all_notifications AS (
    SELECT entity_id, invoice_id, invoice_number, branch_name,
           reference, NULL::uuid AS gift_card_id,
           NULL::text AS gift_card_code, repair_id, order_id, repair_reason, customer_name, customer_mobile, customers,
           kind, notification_id, last_attempt_at, eligible, waiting_since,
           recipient_count, queued_count, accepted_count, delivered_count,
           failed_count, uncertain_count, cancelled_count, recipients, error_message, status, previous_version
    FROM outcomes
    UNION ALL
    SELECT entity_id, invoice_id, invoice_number, branch_name, reference, gift_card_id,
           gift_card_code, NULL::uuid AS repair_id, NULL::uuid AS order_id, NULL::text AS repair_reason,
           customer_name, customer_mobile, customers,
           'gift_card' AS kind, notification_id, last_attempt_at, eligible, waiting_since,
           CASE WHEN notification_id IS NULL THEN 0 ELSE 1 END::bigint AS recipient_count,
           CASE WHEN delivery_state IN ('queued', 'sending') THEN 1 ELSE 0 END::bigint AS queued_count,
           CASE WHEN delivery_state = 'accepted' THEN 1 ELSE 0 END::bigint AS accepted_count,
           CASE WHEN delivery_state IN ('delivered', 'read') THEN 1 ELSE 0 END::bigint AS delivered_count,
           CASE WHEN delivery_state = 'failed' THEN 1 ELSE 0 END::bigint AS failed_count,
           CASE WHEN delivery_state = 'uncertain' THEN 1 ELSE 0 END::bigint AS uncertain_count,
           CASE WHEN delivery_state = 'cancelled' THEN 1 ELSE 0 END::bigint AS cancelled_count,
           CASE WHEN notification_id IS NULL THEN '[]'::jsonb ELSE
               jsonb_build_array(jsonb_build_object('id', notification_id,
                   'normalizedMobile', normalized_mobile, 'customers', customers,
                   'selected', true, 'status', CASE WHEN delivery_state = 'sending' THEN 'submitting' ELSE delivery_state END,
                   'errorMessage', error_message)) END AS recipients,
           error_message, status, 'null'::jsonb AS previous_version
    FROM gift_card_context WHERE eligible OR notification_id IS NOT NULL
)
SELECT *, eligible AND status IN ('not_sent', 'failed', 'uncertain', 'delayed') AS needs_attention
FROM all_notifications
