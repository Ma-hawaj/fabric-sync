use super::readiness::{ReadyOrder, Stage, Summary};
use super::types::ProgressRow;
use crate::error::AppError;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

pub async fn summary(db: &PgPool, invoice: Uuid) -> Result<Summary, AppError> {
    sqlx::query_as("SELECT * FROM invoice_readiness WHERE invoice_id=$1")
        .bind(invoice)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found.".into()))
}

pub async fn lock_invoice(conn: &mut PgConnection, invoice: Uuid) -> Result<(), AppError> {
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM invoices WHERE id=$1 FOR UPDATE")
        .bind(invoice)
        .fetch_optional(conn)
        .await?
        .ok_or_else(|| AppError::NotFound("Invoice not found.".into()))?;
    Ok(())
}

pub async fn status(conn: &mut PgConnection, invoice: Uuid) -> Result<String, AppError> {
    Ok(
        sqlx::query_scalar("SELECT readiness_status FROM invoice_readiness WHERE invoice_id=$1")
            .bind(invoice)
            .fetch_one(conn)
            .await?,
    )
}

pub async fn lock_orders(
    conn: &mut PgConnection,
    invoice: Uuid,
    order: Option<Uuid>,
) -> Result<Vec<ReadyOrder>, AppError> {
    Ok(sqlx::query_as("SELECT o.id,o.order_number,o.status,o.production_branch_id,i.branch_id FROM orders o JOIN invoices i ON i.id=o.invoice_id WHERE o.invoice_id=$1 AND ($2::uuid IS NULL OR o.id=$2) AND NOT EXISTS (SELECT 1 FROM invoice_return_lines l WHERE l.order_id=o.id) AND ($2::uuid IS NOT NULL OR o.status <> 'collected') ORDER BY o.id FOR UPDATE OF o").bind(invoice).bind(order).fetch_all(conn).await?)
}

pub async fn stages(conn: &mut PgConnection, order: Uuid) -> Result<Vec<Stage>, AppError> {
    Ok(sqlx::query_as("SELECT s.name,s.requires_delivery,coalesce(p.status,'pending') AS status,p.location_id FROM order_stages s LEFT JOIN order_stage_progress p ON p.stage_id=s.id AND p.order_id=$1 WHERE s.is_active OR p.id IS NOT NULL ORDER BY s.sort_order,s.name").bind(order).fetch_all(conn).await?)
}

pub async fn has_repair(conn: &mut PgConnection, order: Uuid) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM order_repairs WHERE order_id=$1 AND status IN ('open','in_progress'))").bind(order).fetch_one(conn).await?)
}

pub async fn mark_ready(
    conn: &mut PgConnection,
    ids: &[Uuid],
    actor: &str,
    invoice: Uuid,
) -> Result<(), AppError> {
    sqlx::query("UPDATE orders SET status='ready',ready_at=now(),ready_by=$2,ready_location_id=(SELECT branch_id FROM invoices WHERE id=$3),readiness_version=readiness_version+1 WHERE id=ANY($1) AND status='pending'").bind(ids).bind(actor).bind(invoice).execute(conn).await?;
    Ok(())
}

pub async fn next_generation(conn: &mut PgConnection, invoice: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE invoices SET readiness_generation=readiness_generation+1 WHERE id=$1")
        .bind(invoice)
        .execute(conn)
        .await?;
    Ok(())
}

pub async fn invoice_for_order(db: &PgPool, order: Uuid) -> Result<Uuid, AppError> {
    sqlx::query_scalar("SELECT invoice_id FROM orders WHERE id=$1")
        .bind(order)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Order not found.".into()))
}

pub async fn reopen(conn: &mut PgConnection, order: Uuid) -> Result<bool, AppError> {
    Ok(sqlx::query("UPDATE orders SET status='pending',ready_at=NULL,ready_by=NULL,ready_location_id=NULL,readiness_version=readiness_version+1 WHERE id=$1 AND status='ready'").bind(order).execute(conn).await?.rows_affected() > 0)
}

pub async fn locations(
    conn: &mut PgConnection,
    order: Uuid,
) -> Result<(Option<Uuid>, Option<Uuid>), AppError> {
    Ok(sqlx::query_as("SELECT o.production_branch_id,i.branch_id FROM orders o JOIN invoices i ON i.id=o.invoice_id WHERE o.id=$1").bind(order).fetch_one(conn).await?)
}

pub async fn progress(conn: &mut PgConnection, order: Uuid) -> Result<Vec<ProgressRow>, AppError> {
    Ok(sqlx::query_as("SELECT p.order_id,p.stage_id,p.status,p.completed_at,p.location_id,b.name AS location,p.notes FROM order_stage_progress p LEFT JOIN branch b ON b.id=p.location_id WHERE p.order_id=$1").bind(order).fetch_all(conn).await?)
}
