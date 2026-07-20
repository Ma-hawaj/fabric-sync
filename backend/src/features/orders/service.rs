use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{Order, PaymentType},
};

pub async fn list_orders(state: &AppState) -> Result<Vec<Order>, AppError> {
    Ok(repository::list_orders(state).await?)
}

/// Marks an order received and, once every order on its invoice has been
/// received, settles the invoice's remaining balance in full via
/// `final_payment_type`.
pub async fn receive_order(
    state: &AppState,
    order_id: Uuid,
    final_payment_type: PaymentType,
) -> Result<Order, AppError> {
    let mut tx = state.db().begin().await?;

    let invoice_id = repository::mark_received(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    if repository::invoice_fully_received(&mut tx, invoice_id).await? {
        repository::mark_invoice_paid(&mut tx, invoice_id, final_payment_type).await?;
    }

    tx.commit().await?;

    Ok(repository::get_order(state, order_id)
        .await?
        .expect("order was just updated"))
}
