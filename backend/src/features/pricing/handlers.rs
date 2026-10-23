use axum::{extract::State, Json};

use crate::{error::AppError, state::AppState};

use super::types::Pricing;

pub async fn get_pricing(State(state): State<AppState>) -> Result<Json<Pricing>, AppError> {
    Ok(Json(Pricing {
        urgent_charge: state.urgent_charge_rule()?,
    }))
}
