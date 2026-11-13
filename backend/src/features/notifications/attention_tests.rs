use super::{attention, types::AttentionRow};
use crate::{features::orders::readiness, list::ListParams, test_support};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn rows(pool: &PgPool) -> Vec<AttentionRow> {
    attention::list(pool, &ListParams::default())
        .await
        .unwrap()
        .data
}

async fn request(pool: &PgPool, invoice: Uuid, kind: &str, repair: Option<Uuid>) {
    super::repository::request_notification(
        &mut *pool.acquire().await.unwrap(),
        invoice,
        kind,
        repair,
    )
    .await
    .unwrap();
}

async fn request_id(
    pool: &PgPool,
    invoice: Uuid,
    kind: &str,
    repair: Option<Uuid>,
) -> Option<Uuid> {
    super::repository::request_id(&mut *pool.acquire().await.unwrap(), invoice, kind, repair)
        .await
        .unwrap()
}

async fn approved(pool: &PgPool, invoice: Uuid, kind: &str, generation: i64) -> Uuid {
    let (revision, _) = super::repository::revision(pool, invoice).await.unwrap();
    let event = request_id(
        pool,
        invoice,
        if kind == "invoice_ready" {
            "invoice_ready"
        } else {
            "invoice"
        },
        None,
    )
    .await;
    sqlx::query_scalar(
        "INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,state,snapshot,created_by,approved_by,approved_at) \
         VALUES($1,$2,$3,'test', $4,'approved',$5,'staff','staff',now()) RETURNING id",
    )
    .bind(invoice)
    .bind(kind)
    .bind(format!("test:{}", Uuid::new_v4()))
    .bind(Uuid::new_v4())
    .bind(json!({"readinessGeneration":generation,"revision":revision,"attentionEventId":event}))
    .fetch_one(pool).await.unwrap()
}

async fn recipient(pool: &PgPool, notification: Uuid, mobile: &str, status: &str) {
    sqlx::query("INSERT INTO notification_recipients(notification_id,normalized_mobile,customers,status,error_message) VALUES($1,$2,'[]',$3,CASE WHEN $3='failed' THEN 'Invalid destination' END)")
        .bind(notification).bind(mobile).bind(status).execute(pool).await.unwrap();
}

#[sqlx::test]
async fn attention_includes_invoices_without_any_preview_or_approved_send(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].invoice_id, Some(invoice));
    assert_eq!(result[0].status, "not_sent");
    assert!(result[0].needs_attention);
    assert!(result[0].notification_id.is_none());
    // An unapproved preview, including one abandoned in another tab, isn't a send.
    sqlx::query("INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,snapshot,created_by) VALUES($1,'invoice_created','created','test',$2,'{}','staff')")
        .bind(invoice).bind(Uuid::new_v4()).execute(&pool).await.unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
}

#[sqlx::test]
async fn attention_does_not_invent_work_for_imported_invoices_or_repairs(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    // Imports write domain rows without a notification request. Attribution or
    // recent edits must not be used to guess whether historical work is due.
    sqlx::query("DELETE FROM notification_requests WHERE invoice_id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE invoices SET created_by='known historical actor' WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE orders SET status='ready',ready_at=now() WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO order_repairs(order_id,reason,status,completed_at) VALUES($1,'Imported repair','completed',now())")
        .bind(orders[0]).execute(&pool).await.unwrap();
    sqlx::query("UPDATE customers SET name='Corrected historical name'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(rows(&pool).await.is_empty());
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);

    // Real attempts, including failures for old invoices, remain visible.
    let failed = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, failed, "+97333112233", "failed").await;
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].status, "failed");
    assert_eq!(attention::summary(&pool).await.unwrap().failed, 1);
}

#[sqlx::test]
async fn attention_tracks_new_pickup_activity_on_an_imported_invoice(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("DELETE FROM notification_requests WHERE invoice_id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    assert!(rows(&pool).await.is_empty());
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].kind, "invoice_ready");
    assert!(result[0].needs_attention);
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
}

#[sqlx::test]
async fn attention_does_not_reopen_delivered_invoices_for_related_data_edits(pool: PgPool) {
    let (first, first_orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    let sent = approved(&pool, first, "invoice_created", 0).await;
    recipient(&pool, sent, "+97333112233", "delivered").await;
    sqlx::query("UPDATE customers SET name='First historical customer'")
        .execute(&pool)
        .await
        .unwrap();
    let (second, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let sent = approved(&pool, second, "invoice_created", 0).await;
    recipient(&pool, sent, "+97333112233", "delivered").await;
    let before = super::repository::revision(&pool, first).await.unwrap().0;
    sqlx::query("UPDATE customers SET address='Corrected address',mobile_no='+97333112233'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE branch SET name=name || ' renamed' WHERE id=$1")
        .bind(pickup)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO invoice_payments(invoice_id,amount,payment_type) VALUES($1,10,'cash')",
    )
    .bind(first)
    .execute(&pool)
    .await
    .unwrap();
    test_support::finish_stages(&pool, first_orders[0], pickup).await;
    sqlx::query("UPDATE invoices SET target_date=CURRENT_DATE WHERE id=$1")
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();
    assert!(super::repository::revision(&pool, first).await.unwrap().0 > before);
    let result = rows(&pool).await;
    assert_eq!(result.len(), 2);
    assert!(result.iter().all(|row| row.status == "delivered"
        && !row.needs_attention
        && row.previous_version.is_null()));
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
}

#[sqlx::test]
async fn attention_preserves_unresolved_destinations_across_incidental_content_changes(
    pool: PgPool,
) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, original, "+97333112233", "delivered").await;
    recipient(&pool, original, "+97333991122", "failed").await;
    recipient(&pool, original, "+97333445566", "failed").await;
    sqlx::query("UPDATE customers SET name='Corrected name'")
        .execute(&pool)
        .await
        .unwrap();
    let resent = approved(&pool, invoice, "manual_resend", 0).await;
    sqlx::query("UPDATE notifications SET source_hash='refreshed-preview' WHERE id=$1")
        .bind(resent)
        .execute(&pool)
        .await
        .unwrap();
    recipient(&pool, resent, "+97333991122", "delivered").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].status, "failed");
    assert_eq!(result[0].delivered_count, 2);
    assert_eq!(result[0].failed_count, 1);
    assert_eq!(result[0].recipient_count, 3);
    assert!(result[0].previous_version.is_null());
}

#[sqlx::test]
async fn notification_requests_rollback_with_the_business_action(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = request_id(&pool, invoice, "invoice", None).await;
    let mut tx = pool.begin().await.unwrap();
    super::repository::request_notification(&mut tx, invoice, "invoice", None)
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    assert_eq!(request_id(&pool, invoice, "invoice", None).await, original);
}

#[sqlx::test]
async fn invoice_create_and_explicit_edit_record_their_own_notification_actions(pool: PgPool) {
    let customer: Uuid = sqlx::query_scalar(
        "INSERT INTO customers(name,mobile_no) VALUES('Invoice buyer','33112233') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let state = test_support::state(pool.clone(), None, None).await;
    let mut input: crate::features::invoices::types::CreateInvoiceInput =
        serde_json::from_value(json!({
        "expectedVatRate":0.1,"discountUnit":"amount","customerId":customer,
            "giftCards":[{"amount":25,"boughtFor":"Recipient","recipientPhone":"33991122"}]
        }))
        .unwrap();
    let created =
        crate::features::invoices::service::create_invoice(&state, input.clone(), "staff")
            .await
            .unwrap();
    let first_event = request_id(&pool, created.id, "invoice", None).await;
    assert!(first_event.is_some());
    let sent = approved(&pool, created.id, "invoice_created", 0).await;
    recipient(&pool, sent, "+97333112233", "delivered").await;
    sqlx::query("UPDATE customers SET name='Corrected buyer' WHERE id=$1")
        .bind(customer)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        request_id(&pool, created.id, "invoice", None).await,
        first_event
    );
    assert_eq!(
        rows(&pool)
            .await
            .iter()
            .find(|row| row.kind == "invoice")
            .unwrap()
            .status,
        "delivered"
    );

    input.gift_cards[0].code = created.gift_cards[0].code.clone();
    input.gift_cards[0].amount = 30.0;
    crate::features::invoices::service::update_invoice(&state, created.id, input)
        .await
        .unwrap();
    assert_ne!(
        request_id(&pool, created.id, "invoice", None).await,
        first_event
    );
    let result = rows(&pool).await;
    let updated = result.iter().find(|row| row.kind == "invoice").unwrap();
    assert_eq!(updated.status, "not_sent");
    assert!(updated.needs_attention);
    assert_eq!(updated.previous_version["status"], "delivered");
}

#[sqlx::test]
async fn attention_flags_a_requested_invoice_update_and_preserves_the_previous_results(
    pool: PgPool,
) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, original, "+97333112233", "delivered").await;
    assert!(!rows(&pool).await[0].needs_attention);
    sqlx::query("UPDATE invoices SET total_price=120 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    request(&pool, invoice, "invoice", None).await;
    let result = rows(&pool).await;
    let row = &result[0];
    assert_eq!(row.status, "not_sent");
    assert!(row.needs_attention);
    assert_eq!(row.notification_id, Some(original));
    assert_eq!(row.delivered_count, 0);
    assert!(row.recipients.as_array().unwrap().is_empty());
    assert_eq!(row.previous_version["status"], "delivered");
    assert_eq!(row.previous_version["recipients"][0]["status"], "delivered");
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);

    // Opening or abandoning a current preview cannot clear the outstanding version.
    sqlx::query("INSERT INTO notifications(invoice_id,kind,event_key,source_hash,preview_version,snapshot,created_by) VALUES($1,'invoice_updated','updated','new-version',$2,'{}','staff')")
        .bind(invoice).bind(Uuid::new_v4()).execute(&pool).await.unwrap();
    assert!(rows(&pool).await[0].needs_attention);

    let updated = approved(&pool, invoice, "invoice_updated", 0).await;
    sqlx::query("UPDATE notifications SET source_hash='new-version' WHERE id=$1")
        .bind(updated)
        .execute(&pool)
        .await
        .unwrap();
    recipient(&pool, updated, "+97333112233", "queued").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].status, "queued");
    assert!(!result[0].needs_attention);
    assert!(result[0].previous_version.is_null());
    assert_eq!(result[0].delivered_count, 0);
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);

    // A late callback for the older content cannot mark this version delivered.
    sqlx::query("UPDATE notification_recipients SET status='read' WHERE notification_id=$1")
        .bind(original)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(rows(&pool).await[0].status, "queued");
    assert_eq!(
        super::repository::history(&pool, invoice)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[sqlx::test]
async fn attention_retains_uncertain_previous_delivery_when_the_invoice_changes(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, original, "+97333112233", "uncertain").await;
    sqlx::query("UPDATE invoices SET total_price=120 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    request(&pool, invoice, "invoice", None).await;
    let result = rows(&pool).await;
    assert_eq!(result[0].status, "not_sent");
    assert_eq!(result[0].uncertain_count, 0);
    assert_eq!(result[0].previous_version["status"], "uncertain");
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
}

#[sqlx::test]
async fn attention_keeps_ready_results_after_unrelated_invoice_changes(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let repair_id = repair(&pool, orders[0]).await;
    let pickup_notice = approved(&pool, invoice, "invoice_ready", 1).await;
    recipient(&pool, pickup_notice, "+97333112233", "delivered").await;
    repair_notice(&pool, invoice, repair_id, "accepted").await;
    sqlx::query("UPDATE invoices SET total_price=120 WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    let result = rows(&pool).await;
    let pickup = result
        .iter()
        .find(|row| row.kind == "invoice_ready")
        .unwrap();
    assert_eq!(pickup.status, "delivered");
    assert!(pickup.previous_version.is_null());
    let repair = result
        .iter()
        .find(|row| row.repair_id == Some(repair_id))
        .unwrap();
    assert_eq!(repair.status, "accepted");
    assert!(repair.previous_version.is_null());
    assert!(!repair.needs_attention);
    assert_eq!(repair.accepted_count, 1);
}

#[sqlx::test]
async fn attention_shows_partial_failures_and_resolves_after_a_successful_resend(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let first = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, first, "+97333112233", "delivered").await;
    recipient(&pool, first, "+97333991122", "failed").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].status, "failed");
    assert_eq!(result[0].recipient_count, 2);
    assert_eq!(result[0].failed_count, 1);
    assert_eq!(result[0].delivered_count, 1);
    assert_eq!(
        result[0].error_message.as_deref(),
        Some("Invalid destination")
    );
    let resend = approved(&pool, invoice, "manual_resend", 0).await;
    recipient(&pool, resend, "+97333991122", "read").await;
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].notification_id, Some(resend));
    assert_eq!(result[0].status, "delivered");
    assert!(!result[0].needs_attention);
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
}

#[sqlx::test]
async fn attention_keeps_other_failures_visible_after_a_selective_resend(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, original, "+97333112233", "delivered").await;
    recipient(&pool, original, "+97333991122", "failed").await;
    recipient(&pool, original, "+97333445566", "failed").await;
    let resend = approved(&pool, invoice, "manual_resend", 0).await;
    recipient(&pool, resend, "+97333991122", "delivered").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].recipient_count, 3);
    assert_eq!(result[0].delivered_count, 2);
    assert_eq!(result[0].failed_count, 1);
    assert!(result[0].needs_attention);
    assert_eq!(result[0].recipients.as_array().unwrap().len(), 3);
    assert_eq!(attention::summary(&pool).await.unwrap().failed, 1);
}

#[sqlx::test]
async fn attention_separates_queued_delayed_accepted_and_uncertain_messages(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let send = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, send, "+97333112233", "queued").await;
    assert_eq!(rows(&pool).await[0].status, "queued");
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
    sqlx::query("UPDATE notifications SET approved_at=now()-interval '31 minutes' WHERE id=$1")
        .bind(send)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().delayed, 1);
    sqlx::query("UPDATE notification_recipients SET status='accepted' WHERE notification_id=$1")
        .bind(send)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(rows(&pool).await[0].status, "accepted");
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
    sqlx::query("UPDATE notification_recipients SET status='uncertain' WHERE notification_id=$1")
        .bind(send)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().uncertain, 1);
}

#[sqlx::test]
async fn attention_preserves_an_old_queued_destination_after_a_selective_resend(pool: PgPool) {
    let (invoice, _, _, _) = test_support::invoice(&pool, 1, false).await;
    let original = approved(&pool, invoice, "invoice_created", 0).await;
    recipient(&pool, original, "+97333112233", "queued").await;
    sqlx::query("UPDATE notifications SET approved_at=now()-interval '31 minutes' WHERE id=$1")
        .bind(original)
        .execute(&pool)
        .await
        .unwrap();
    let resend = approved(&pool, invoice, "manual_resend", 0).await;
    recipient(&pool, resend, "+97333991122", "delivered").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].status, "delayed");
    assert_eq!(result[0].queued_count, 1);
    assert_eq!(result[0].delivered_count, 1);
}

#[sqlx::test]
async fn attention_requires_a_new_pickup_notice_after_production_is_reopened(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 2);
    let ready = approved(&pool, invoice, "invoice_ready", 1).await;
    recipient(&pool, ready, "+97333112233", "delivered").await;
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
    readiness::reopen(&pool, orders[0], "staff", "Recheck stitching")
        .await
        .unwrap();
    assert!(
        !rows(&pool)
            .await
            .iter()
            .find(|r| r.kind == "invoice_ready")
            .unwrap()
            .eligible
    );
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let result = rows(&pool).await;
    let ready = result.iter().find(|r| r.kind == "invoice_ready").unwrap();
    assert_eq!(ready.status, "not_sent");
    assert!(ready.needs_attention);
    assert_eq!(ready.delivered_count, 0);
    assert!(ready.recipients.as_array().unwrap().is_empty());
}

#[sqlx::test]
async fn attention_excludes_opted_out_walk_in_and_delivery_pickup_notices(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    sqlx::query("UPDATE invoices SET collection_method='delivery' WHERE id=$1")
        .bind(invoice)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(rows(&pool).await.len(), 1);
    sqlx::query("UPDATE customers SET whatsapp_notifications_enabled=false")
        .execute(&pool)
        .await
        .unwrap();
    assert!(rows(&pool).await.is_empty());
    sqlx::query("UPDATE customers SET name='Existing customer'")
        .execute(&pool)
        .await
        .unwrap();
    let (walk_in, _, _, _) = test_support::invoice(&pool, 0, false).await;
    assert!(!rows(&pool)
        .await
        .iter()
        .any(|row| row.invoice_id == Some(walk_in)));
}

#[sqlx::test]
async fn attention_summary_counts_all_matching_items_beyond_the_current_page(pool: PgPool) {
    test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE customers SET name='Existing customer'")
        .execute(&pool)
        .await
        .unwrap();
    test_support::invoice(&pool, 1, false).await;
    let params = ListParams {
        page: 1,
        per_page: Some(1),
        ..Default::default()
    };
    let result = attention::list(&pool, &params).await.unwrap();
    assert_eq!(result.data.len(), 1);
    assert_eq!(result.total, 2);
    assert_eq!(attention::summary(&pool).await.unwrap().total, 2);
}

async fn gift_card(pool: &PgPool) -> Uuid {
    sqlx::query_scalar("INSERT INTO gift_cards(code,initial_amount,balance,bought_for,recipient_phone) VALUES('GC-ATTENTION',25,25,'Fatima','33991122') RETURNING id")
        .fetch_one(pool).await.unwrap()
}

async fn gift_card_delivery(pool: &PgPool, card: Uuid, status: &str) -> Uuid {
    sqlx::query_scalar("INSERT INTO gift_card_deliveries(gift_card_id,request_id,approved_by,source_hash,normalized_mobile,body,parameters,template_name,language,image_png,image_filename,image_sha256,state,last_error) VALUES($1,$2,'staff','test','+97333991122','Gift card','[]','gift_card_image_v1','en_US',decode('01','hex'),'card.png',repeat('a',64),$3,CASE WHEN $3='failed' THEN 'Invalid destination' END) RETURNING id")
        .bind(card).bind(Uuid::new_v4()).bind(status).fetch_one(pool).await.unwrap()
}

#[sqlx::test]
async fn attention_identifies_unsent_standalone_gift_cards(pool: PgPool) {
    let card = gift_card(&pool).await;
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].kind, "gift_card");
    assert_eq!(result[0].entity_id, card);
    assert_eq!(result[0].gift_card_id, Some(card));
    assert_eq!(result[0].reference, "GC-ATTENTION");
    assert!(result[0].invoice_id.is_none());
    assert_eq!(result[0].status, "not_sent");
    assert_eq!(result[0].customers[0]["name"], "Fatima");
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
}

#[sqlx::test]
async fn attention_includes_gift_card_failures_and_uses_the_latest_resend(pool: PgPool) {
    let card = gift_card(&pool).await;
    gift_card_delivery(&pool, card, "failed").await;
    let result = rows(&pool).await;
    assert_eq!(result[0].failed_count, 1);
    assert_eq!(result[0].recipient_count, 1);
    assert_eq!(result[0].recipients[0]["normalizedMobile"], "+97333991122");
    assert_eq!(
        result[0].error_message.as_deref(),
        Some("Invalid destination")
    );
    assert_eq!(attention::summary(&pool).await.unwrap().failed, 1);
    let resend = gift_card_delivery(&pool, card, "read").await;
    let result = rows(&pool).await;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].notification_id, Some(resend));
    assert_eq!(result[0].status, "delivered");
    assert_eq!(result[0].delivered_count, 1);
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
}

#[sqlx::test]
async fn attention_normalizes_gift_card_queue_states_and_excludes_retired_cards(pool: PgPool) {
    let card = gift_card(&pool).await;
    let send = gift_card_delivery(&pool, card, "sending").await;
    assert_eq!(rows(&pool).await[0].status, "queued");
    sqlx::query(
        "UPDATE gift_card_deliveries SET created_at=now()-interval '31 minutes' WHERE id=$1",
    )
    .bind(send)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().delayed, 1);
    sqlx::query("UPDATE gift_card_deliveries SET state='uncertain' WHERE id=$1")
        .bind(send)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().uncertain, 1);
    sqlx::query("UPDATE gift_card_deliveries SET state='cancelled' WHERE id=$1")
        .bind(send)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().not_sent, 1);
    sqlx::query("UPDATE gift_cards SET is_active=false WHERE id=$1")
        .bind(card)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(attention::summary(&pool).await.unwrap().total, 0);
    assert!(!rows(&pool).await[0].eligible);
}

#[sqlx::test]
async fn attention_filters_notification_types_while_summary_includes_all_types(pool: PgPool) {
    test_support::invoice(&pool, 1, false).await;
    gift_card(&pool).await;
    let params = ListParams {
        page: 1,
        per_page: Some(1),
        filters: serde_json::from_value(json!([
            {"id":"kind","value":["gift_card"],"variant":"multiSelect","operator":"inArray"},
            {"id":"reference","value":"GC-ATTENTION","variant":"text","operator":"iLike"}
        ]))
        .unwrap(),
        ..Default::default()
    };
    let result = attention::list(&pool, &params).await.unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.data[0].kind, "gift_card");
    assert_eq!(attention::summary(&pool).await.unwrap().total, 2);
}

async fn repair(pool: &PgPool, order: Uuid) -> Uuid {
    let id = sqlx::query_scalar("INSERT INTO order_repairs(order_id,reason,status,completed_at) VALUES($1,'Shorten sleeve','completed',now()-interval '15 minutes') RETURNING id")
        .bind(order).fetch_one(pool).await.unwrap();
    let invoice = crate::features::orders::readiness::invoice_for_order(pool, order)
        .await
        .unwrap();
    request(pool, invoice, "repair_ready", Some(id)).await;
    id
}

async fn repair_notice(pool: &PgPool, invoice: Uuid, repair: Uuid, status: &str) -> Uuid {
    let id = approved(pool, invoice, "invoice_ready", 0).await;
    let event = request_id(pool, invoice, "repair_ready", Some(repair)).await;
    sqlx::query("UPDATE notifications SET snapshot=snapshot || jsonb_build_object('repairId',$2::uuid::text,'attentionEventId',$3::uuid::text) WHERE id=$1")
        .bind(id).bind(repair).bind(event).execute(pool).await.unwrap();
    recipient(pool, id, "+97333112233", status).await;
    id
}

#[sqlx::test]
async fn attention_separates_repairs_from_invoice_pickup_notices(pool: PgPool) {
    let (invoice, orders, _, pickup) = test_support::invoice(&pool, 1, false).await;
    test_support::finish_stages(&pool, orders[0], pickup).await;
    readiness::confirm(&pool, invoice, None, "staff", true)
        .await
        .unwrap();
    let normal = approved(&pool, invoice, "invoice_ready", 1).await;
    recipient(&pool, normal, "+97333112233", "delivered").await;
    let first = repair(&pool, orders[0]).await;
    let second = repair(&pool, orders[0]).await;
    let first_send = repair_notice(&pool, invoice, first, "failed").await;
    let second_send = repair_notice(&pool, invoice, second, "accepted").await;
    let result = rows(&pool).await;
    let pickup = result
        .iter()
        .find(|row| row.kind == "invoice_ready")
        .unwrap();
    assert_eq!(pickup.notification_id, Some(normal));
    assert_eq!(pickup.status, "delivered");
    assert!(pickup.previous_version.is_null());
    let first_row = result
        .iter()
        .find(|row| row.repair_id == Some(first))
        .unwrap();
    assert_eq!(first_row.entity_id, first);
    assert_eq!(first_row.kind, "repair_ready");
    assert_eq!(first_row.status, "failed");
    assert!(first_row.needs_attention);
    let second_row = result
        .iter()
        .find(|row| row.repair_id == Some(second))
        .unwrap();
    assert_eq!(second_row.status, "accepted");
    assert!(!second_row.needs_attention);
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        super::repository::latest_approved(&mut conn, invoice, true, first_send)
            .await
            .unwrap(),
        Some(first_send)
    );
    assert_eq!(
        super::repository::latest_approved(&mut conn, invoice, true, normal)
            .await
            .unwrap(),
        Some(normal)
    );
    assert_eq!(
        super::repository::latest_approved(&mut conn, invoice, true, second_send)
            .await
            .unwrap(),
        Some(second_send)
    );
    drop(conn);
    let history = super::repository::history(&pool, invoice).await.unwrap();
    assert_eq!(history.len(), 3);
    assert_eq!(
        history.iter().filter(|row| row.repair_id.is_some()).count(),
        2
    );
}

#[sqlx::test]
async fn attention_shows_unsent_repairs_of_collected_orders_and_clears_received_repairs(
    pool: PgPool,
) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    sqlx::query("UPDATE orders SET status='collected' WHERE id=$1")
        .bind(orders[0])
        .execute(&pool)
        .await
        .unwrap();
    let repair_id = repair(&pool, orders[0]).await;
    let result = rows(&pool).await;
    let row = result
        .iter()
        .find(|row| row.repair_id == Some(repair_id))
        .unwrap();
    assert_eq!(row.status, "not_sent");
    assert!(row.needs_attention);
    assert_eq!(row.order_id, Some(orders[0]));
    assert_eq!(row.invoice_id, Some(invoice));
    sqlx::query("UPDATE order_repairs SET status='received', received_at=now() WHERE id=$1")
        .bind(repair_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!rows(&pool)
        .await
        .iter()
        .any(|row| row.repair_id == Some(repair_id) && row.needs_attention));
}

#[sqlx::test]
async fn attention_requires_a_fresh_notice_when_a_repair_is_completed_again(pool: PgPool) {
    let (invoice, orders, _, _) = test_support::invoice(&pool, 1, false).await;
    let repair_id = repair(&pool, orders[0]).await;
    repair_notice(&pool, invoice, repair_id, "delivered").await;
    sqlx::query("UPDATE order_repairs SET status='open',completed_at=NULL WHERE id=$1")
        .bind(repair_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        !rows(&pool)
            .await
            .iter()
            .find(|row| row.repair_id == Some(repair_id))
            .unwrap()
            .needs_attention
    );
    sqlx::query("UPDATE order_repairs SET status='completed',completed_at=now() WHERE id=$1")
        .bind(repair_id)
        .execute(&pool)
        .await
        .unwrap();
    let result = rows(&pool).await;
    let row = result
        .iter()
        .find(|row| row.repair_id == Some(repair_id))
        .unwrap();
    assert_eq!(row.status, "not_sent");
    assert!(row.needs_attention);
    assert_eq!(row.delivered_count, 0);
}
