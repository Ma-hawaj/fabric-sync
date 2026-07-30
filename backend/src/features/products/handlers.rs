use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    service,
    types::{AddStockInput, CreateProductInput, Product, UpdateProductInput},
};

pub async fn list_products(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Product>>, AppError> {
    Ok(Json(service::list_products(&state).await?))
}

pub async fn create_product(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateProductInput>,
) -> Result<Json<Product>, AppError> {
    Ok(Json(service::create_product(&state, input).await?))
}

pub async fn update_product(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(product_id): Path<Uuid>,
    Json(input): Json<UpdateProductInput>,
) -> Result<Json<Product>, AppError> {
    Ok(Json(
        service::update_product(&state, product_id, input).await?,
    ))
}

pub async fn add_stock(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(product_id): Path<Uuid>,
    Json(input): Json<AddStockInput>,
) -> Result<Json<Product>, AppError> {
    Ok(Json(service::add_stock(&state, product_id, input).await?))
}
