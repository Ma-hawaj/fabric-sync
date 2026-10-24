use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::readiness_repository as repository;
use crate::error::AppError;

#[derive(Clone, Debug, Default, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub readiness_status: String,
    pub ready_order_count: i64,
    pub pending_order_count: i64,
    pub readiness_generation: i64,
}

pub async fn summary(db: &PgPool, invoice_id: Uuid) -> Result<Summary, AppError> {
    repository::summary(db, invoice_id).await
}

#[derive(Debug, FromRow)]
pub(super) struct ReadyOrder {
    pub(super) id: Uuid,
    pub(super) order_number: i64,
    pub(super) status: String,
    pub(super) production_branch_id: Option<Uuid>,
    pub(super) branch_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
pub(super) struct Stage {
    pub(super) name: String,
    pub(super) requires_delivery: bool,
    pub(super) status: String,
    pub(super) location_id: Option<Uuid>,
}

fn blockers(order: &ReadyOrder, stages: &[Stage], has_repair: bool) -> Vec<String> {
    if order.status == "ready" {
        return vec![];
    }
    let mut errors = Vec::new();
    if order.status == "collected" {
        errors.push("Already collected".into());
    }
    if order.production_branch_id.is_none() {
        errors.push("Assign the production location".into());
    }
    if order.branch_id.is_none() {
        errors.push("Choose a pickup branch".into());
    }
    if has_repair {
        errors.push("Complete or cancel outstanding repairs".into());
    }
    if !stages.iter().any(|s| !s.requires_delivery) {
        errors.push("Configure and complete production stages".into());
    }
    let transfer = order.production_branch_id.is_some()
        && order.branch_id.is_some()
        && order.production_branch_id != order.branch_id;
    if transfer && !stages.iter().any(|s| s.requires_delivery) {
        errors.push("Record delivery to the pickup branch".into());
    }
    for stage in stages {
        if stage.requires_delivery {
            if transfer && (stage.status != "done" || stage.location_id != order.branch_id) {
                errors.push(format!(
                    "{} must be delivered to the pickup branch",
                    stage.name
                ));
            }
        } else if stage.status != "done" && stage.status != "skipped" {
            errors.push(format!("Complete {}", stage.name));
        }
    }
    errors
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmInput {
    pub confirmed_at_pickup_branch: bool,
}

#[derive(Debug, Deserialize)]
pub struct ReopenInput {
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyResult {
    pub invoice_id: Uuid,
    pub order_ids: Vec<Uuid>,
    pub became_ready: bool,
    #[serde(flatten)]
    pub readiness: Summary,
}

pub async fn confirm(
    db: &PgPool,
    invoice_id: Uuid,
    order_id: Option<Uuid>,
    actor: &str,
    confirmed: bool,
) -> Result<ReadyResult, AppError> {
    if !confirmed {
        return Err(AppError::BadRequest(
            "Confirm that the garments are available at the pickup branch.".into(),
        ));
    }
    let mut tx = db.begin().await?;
    repository::lock_invoice(&mut tx, invoice_id).await?;
    let was_ready = repository::status(&mut tx, invoice_id).await?;
    let orders = repository::lock_orders(&mut tx, invoice_id, order_id).await?;
    if orders.is_empty() {
        return Err(AppError::BadRequest(
            "There are no uncollected orders to mark ready.".into(),
        ));
    }
    let mut failures = Vec::new();
    for order in &orders {
        let stages = repository::stages(&mut tx, order.id).await?;
        let repair = repository::has_repair(&mut tx, order.id).await?;
        let reasons = blockers(order, &stages, repair);
        if !reasons.is_empty() {
            failures.push(format!(
                "ORD-{}: {}",
                order.order_number,
                reasons.join("; ")
            ));
        }
    }
    if !failures.is_empty() {
        return Err(AppError::Conflict(failures.join("\n")));
    }
    let ids: Vec<Uuid> = orders.iter().map(|o| o.id).collect();
    repository::mark_ready(&mut tx, &ids, actor, invoice_id).await?;
    let now_ready = repository::status(&mut tx, invoice_id).await?;
    let became_ready = was_ready != "ready" && now_ready == "ready";
    if became_ready {
        repository::next_generation(&mut tx, invoice_id).await?;
    }
    tx.commit().await?;
    Ok(ReadyResult {
        invoice_id,
        order_ids: ids,
        became_ready,
        readiness: summary(db, invoice_id).await?,
    })
}

pub async fn invoice_for_order(db: &PgPool, order_id: Uuid) -> Result<Uuid, AppError> {
    repository::invoice_for_order(db, order_id).await
}

pub async fn reopen(
    db: &PgPool,
    order_id: Uuid,
    actor: &str,
    reason: &str,
) -> Result<(), AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Enter a reason for reopening production.".into(),
        ));
    }
    let invoice_id = invoice_for_order(db, order_id).await?;
    let mut tx = db.begin().await?;
    repository::lock_invoice(&mut tx, invoice_id).await?;
    crate::features::returns::service::ensure_order_active(&mut tx, order_id).await?;
    if !repository::reopen(&mut tx, order_id).await? {
        return Err(AppError::Conflict(
            "Only a ready, uncollected order can be reopened.".into(),
        ));
    }
    tracing::info!(%order_id, %actor, reason, "production reopened");
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn order() -> ReadyOrder {
        ReadyOrder {
            id: Uuid::nil(),
            order_number: 1,
            status: "pending".into(),
            production_branch_id: Some(Uuid::from_u128(1)),
            branch_id: Some(Uuid::from_u128(2)),
        }
    }
    fn stage(delivery: bool, status: &str, location: Option<Uuid>) -> Stage {
        Stage {
            name: if delivery { "Delivery" } else { "Sewing" }.into(),
            requires_delivery: delivery,
            status: status.into(),
            location_id: location,
        }
    }
    #[test]
    fn requires_real_delivery_not_a_skipped_or_wrong_branch_transfer() {
        for (state, location) in [
            ("skipped", Some(Uuid::from_u128(2))),
            ("done", Some(Uuid::from_u128(3))),
            ("pending", None),
        ] {
            assert!(!blockers(
                &order(),
                &[stage(false, "done", None), stage(true, state, location)],
                false
            )
            .is_empty());
        }
        assert!(blockers(
            &order(),
            &[
                stage(false, "done", None),
                stage(true, "done", Some(Uuid::from_u128(2)))
            ],
            false
        )
        .is_empty());
    }
    #[test]
    fn empty_stages_unknown_locations_and_open_repairs_are_not_ready() {
        assert!(!blockers(&order(), &[], false).is_empty());
        let mut local = order();
        local.branch_id = local.production_branch_id;
        assert!(!blockers(&local, &[stage(false, "done", None)], true).is_empty());
        local.production_branch_id = None;
        assert!(!blockers(&local, &[stage(false, "done", None)], false).is_empty());
    }
    #[sqlx::test]
    async fn confirmation_is_idempotent_and_serializes_concurrent_staff(pool: PgPool) {
        let (invoice, orders, _, pickup) = crate::test_support::invoice(&pool, 1, false).await;
        crate::test_support::finish_stages(&pool, orders[0], pickup).await;
        let (a, b) = tokio::join!(
            confirm(&pool, invoice, Some(orders[0]), "staff-a", true),
            confirm(&pool, invoice, Some(orders[0]), "staff-b", true)
        );
        let (a, b) = (a.unwrap(), b.unwrap());
        assert_ne!(a.became_ready, b.became_ready);
        let result = summary(&pool, invoice).await.unwrap();
        assert_eq!(result.readiness_status, "ready");
        assert_eq!(result.readiness_generation, 1);
        let before: (chrono::DateTime<chrono::Utc>, String) =
            sqlx::query_as("SELECT ready_at,ready_by FROM orders WHERE id=$1")
                .bind(orders[0])
                .fetch_one(&pool)
                .await
                .unwrap();
        confirm(&pool, invoice, Some(orders[0]), "third-staff", true)
            .await
            .unwrap();
        let after: (chrono::DateTime<chrono::Utc>, String) =
            sqlx::query_as("SELECT ready_at,ready_by FROM orders WHERE id=$1")
                .bind(orders[0])
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(before, after);
    }
    #[sqlx::test]
    async fn bulk_confirmation_rolls_back_all_orders_when_one_is_blocked(pool: PgPool) {
        let (invoice, orders, _, pickup) = crate::test_support::invoice(&pool, 2, false).await;
        crate::test_support::finish_stages(&pool, orders[0], pickup).await;
        assert!(matches!(
            confirm(&pool, invoice, None, "staff", true).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(summary(&pool, invoice).await.unwrap().ready_order_count, 0);
        confirm(&pool, invoice, Some(orders[0]), "staff", true)
            .await
            .unwrap();
        assert_eq!(
            summary(&pool, invoice).await.unwrap().readiness_status,
            "partially_ready"
        );
        crate::test_support::finish_stages(&pool, orders[1], pickup).await;
        let result = confirm(&pool, invoice, None, "staff", true).await.unwrap();
        assert!(result.became_ready);
        assert_eq!(result.readiness.ready_order_count, 2);
    }
    #[sqlx::test]
    async fn reopening_progress_or_repair_clears_readiness_and_new_confirmation_starts_a_generation(
        pool: PgPool,
    ) {
        let (invoice, orders, _, pickup) = crate::test_support::invoice(&pool, 1, false).await;
        crate::test_support::finish_stages(&pool, orders[0], pickup).await;
        confirm(&pool, invoice, None, "staff", true).await.unwrap();
        sqlx::query("DELETE FROM order_stage_progress WHERE order_id=$1 AND stage_id=(SELECT id FROM order_stages WHERE name='finishing')").bind(orders[0]).execute(&pool).await.unwrap();
        assert_eq!(
            summary(&pool, invoice).await.unwrap().readiness_status,
            "in_progress"
        );
        sqlx::query("INSERT INTO order_stage_progress(order_id,stage_id,status) SELECT $1,id,'done' FROM order_stages WHERE name='finishing'").bind(orders[0]).execute(&pool).await.unwrap();
        assert!(
            confirm(&pool, invoice, None, "staff", true)
                .await
                .unwrap()
                .became_ready
        );
        assert_eq!(
            summary(&pool, invoice).await.unwrap().readiness_generation,
            2
        );
        sqlx::query("INSERT INTO order_repairs(order_id,reason) VALUES($1,'Rework before pickup')")
            .bind(orders[0])
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(summary(&pool, invoice).await.unwrap().ready_order_count, 0);
        assert!(confirm(&pool, invoice, None, "staff", true).await.is_err());
    }
    #[sqlx::test]
    async fn pickup_branch_changes_clear_ready_without_trigger_recursion(pool: PgPool) {
        let (invoice, orders, production, pickup) =
            crate::test_support::invoice(&pool, 1, true).await;
        crate::test_support::finish_stages(&pool, orders[0], pickup).await;
        confirm(&pool, invoice, None, "staff", true).await.unwrap();
        sqlx::query("UPDATE invoices SET branch_id=$2 WHERE id=$1")
            .bind(invoice)
            .bind(production)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            summary(&pool, invoice).await.unwrap().readiness_status,
            "in_progress"
        );
        confirm(&pool, invoice, None, "staff", true).await.unwrap();
        sqlx::query("UPDATE orders SET status='collected',collected_at=now() WHERE id=$1")
            .bind(orders[0])
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            summary(&pool, invoice).await.unwrap().readiness_status,
            "collected"
        );
        assert!(confirm(&pool, invoice, None, "staff", true).await.is_err());
    }
}
