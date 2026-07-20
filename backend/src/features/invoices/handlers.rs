use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{CreateInvoiceInput, CreatedInvoice, InvoiceListItem},
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
