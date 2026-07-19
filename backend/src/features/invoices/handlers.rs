use axum::{extract::State, Extension, Json};

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{CreateInvoiceInput, CreatedInvoice},
};

pub async fn create_invoice(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateInvoiceInput>,
) -> Result<Json<CreatedInvoice>, AppError> {
    Ok(Json(service::create_invoice(&state, input).await?))
}
