use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{CreateGiftCardInput, GiftCard, UpdateGiftCardInput},
};

pub async fn list_gift_cards(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<GiftCard>>, AppError> {
    Ok(Json(service::list_gift_cards(&state).await?))
}

pub async fn create_gift_card(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateGiftCardInput>,
) -> Result<Json<GiftCard>, AppError> {
    Ok(Json(service::create_gift_card(&state, input).await?))
}

pub async fn update_gift_card(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(gift_card_id): Path<Uuid>,
    Json(input): Json<UpdateGiftCardInput>,
) -> Result<Json<GiftCard>, AppError> {
    Ok(Json(
        service::update_gift_card(&state, gift_card_id, input).await?,
    ))
}
