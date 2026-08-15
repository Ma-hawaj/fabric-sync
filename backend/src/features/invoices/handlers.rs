use axum::{
    extract::{Path, State},
    response::Html,
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    auth::AuthenticatedUser,
    error::AppError,
    list::{ListParams, Page},
    state::AppState,
};

use super::{
    document, service,
    types::{
        CreateInvoiceInput, CreatedInvoice, InvoiceDetail, InvoiceListItem, ReceiveInvoiceInput,
        ReceivedInvoice,
    },
};

pub async fn list_invoices(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<InvoiceListItem>>, AppError> {
    Ok(Json(service::list_invoices(&state, &params).await?))
}

pub async fn get_invoice(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(invoice_id): Path<Uuid>,
) -> Result<Json<InvoiceDetail>, AppError> {
    Ok(Json(service::get_invoice(&state, invoice_id).await?))
}

/// The printable invoice, as HTML. Fetched rather than navigated to — the
/// client writes it into an iframe and prints that — so it can carry an
/// Authorization header once there is one to carry.
pub async fn invoice_document(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(invoice_id): Path<Uuid>,
) -> Result<Html<String>, AppError> {
    Ok(Html(
        document::render_invoice_document(&state, invoice_id).await?,
    ))
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
