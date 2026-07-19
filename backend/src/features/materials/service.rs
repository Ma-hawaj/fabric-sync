use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{AddStockInput, CreateMaterialInput, Material},
};

pub async fn list_materials(state: &AppState) -> Result<Vec<Material>, AppError> {
    Ok(repository::list_materials(state).await?)
}

pub async fn create_material(
    state: &AppState,
    input: CreateMaterialInput,
) -> Result<Material, AppError> {
    let material_id = repository::create_material(
        state,
        &input.name,
        input.sku.as_deref(),
        &input.unit,
        &input.entries,
    )
    .await?;

    Ok(repository::get_material(state, material_id)
        .await?
        .expect("material was just created"))
}

pub async fn add_stock(
    state: &AppState,
    material_id: Uuid,
    input: AddStockInput,
) -> Result<Material, AppError> {
    if repository::get_material(state, material_id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound(format!(
            "material {material_id} not found"
        )));
    }

    repository::add_stock(state, material_id, &input.entries).await?;

    Ok(repository::get_material(state, material_id)
        .await?
        .expect("material was just confirmed to exist"))
}
