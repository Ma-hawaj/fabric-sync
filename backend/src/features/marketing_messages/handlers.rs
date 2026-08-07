use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{Campaign, CreateCampaignInput},
};

pub async fn list_campaigns(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Campaign>>, AppError> {
    Ok(Json(service::list_campaigns(&state).await?))
}

pub async fn create_campaign(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateCampaignInput>,
) -> Result<Json<Campaign>, AppError> {
    Ok(Json(
        service::create_campaign(&state, user.subject(), input).await?,
    ))
}

pub async fn get_campaign(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<Campaign>, AppError> {
    Ok(Json(service::get_campaign(&state, campaign_id).await?))
}
