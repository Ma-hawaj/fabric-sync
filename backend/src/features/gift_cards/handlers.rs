use axum::{
    extract::{Path, State},
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
    delivery, image, service,
    types::{CreateGiftCardInput, GiftCard, UpdateGiftCardInput},
};

pub async fn download_image(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let image = image::get(&state, id).await?;
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, image::MIME.to_string()),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", image.filename),
            ),
            (
                axum::http::header::CACHE_CONTROL,
                "private, no-store".into(),
            ),
        ],
        image.png,
    ))
}

pub async fn preview_delivery(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<delivery::Preview>, AppError> {
    Ok(Json(delivery::preview(&state, id).await?))
}

pub async fn send_gift_card(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<delivery::SendInput>,
) -> Result<Json<delivery::DeliveryResult>, AppError> {
    Ok(Json(
        delivery::approve(&state, id, input, user.subject().unwrap_or("staff")).await?,
    ))
}

pub async fn list_gift_cards(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<GiftCard>>, AppError> {
    Ok(Json(service::list_gift_cards(&state, &params).await?))
}

pub async fn get_gift_card_by_code(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(code): Path<String>,
) -> Result<Json<GiftCard>, AppError> {
    Ok(Json(service::get_gift_card_by_code(&state, &code).await?))
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
