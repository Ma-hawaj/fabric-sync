use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{
        CreateInvoiceInput, CreatedInvoice, InvoiceListItem, ReceiveInvoiceInput, ReceivedInvoice,
    },
};

pub async fn list_invoices(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<InvoiceListItem>>, AppError> {
    Ok(Json(service::list_invoices(&state).await?))
}

pub async fn create_invoice(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateInvoiceInput>,
) -> Result<Json<CreatedInvoice>, AppError> {
    Ok(Json(service::create_invoice(&state, input).await?))
}

pub async fn receive_invoice(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(invoice_id): Path<Uuid>,
    Json(input): Json<ReceiveInvoiceInput>,
) -> Result<Json<ReceivedInvoice>, AppError> {
    Ok(Json(
        service::receive_invoice(&state, invoice_id, input.payment_type).await?,
    ))
}
