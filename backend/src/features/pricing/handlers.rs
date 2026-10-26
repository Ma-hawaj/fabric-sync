use axum::{extract::State, Json};

use crate::{error::AppError, state::AppState};

use super::types::Pricing;

pub async fn get_pricing(State(state): State<AppState>) -> Result<Json<Pricing>, AppError> {
    Ok(Json(Pricing {
        vat_rate: state.vat_rate()?,
        urgent_charge: state.urgent_charge_rule()?,
        customer_material_base_price: state.customer_material_base_price()?,
    }))
}
