use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
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
    service,
    types::{CreateDesignOptionInput, DesignOption, UpdateDesignOptionInput},
};

pub async fn list_options(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    params: ListParams,
) -> Result<Json<Page<DesignOption>>, AppError> {
    Ok(Json(service::list_options(&state, &params).await?))
}

pub async fn create_option(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(input): Json<CreateDesignOptionInput>,
) -> Result<Json<DesignOption>, AppError> {
    Ok(Json(service::create_option(&state, input).await?))
}

pub async fn update_option(
    State(state): State<AppState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(option_id): Path<Uuid>,
    Json(input): Json<UpdateDesignOptionInput>,
) -> Result<Json<DesignOption>, AppError> {
    Ok(Json(
        service::update_option(&state, option_id, input).await?,
    ))
}

/// The stored illustration, served publicly so an `<img>` can load it without
/// a bearer token. SVG is still an active document when opened directly, so
/// the response gives it a sandboxed, script-free CSP rather than relying on
/// the caller to use it only as an image.
pub async fn get_image(
    State(state): State<AppState>,
    Path(option_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let (bytes, mime) = service::get_image(&state, option_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("design option {option_id} not found")))?;
    if bytes.is_empty() {
        return Err(AppError::NotFound(format!(
            "design option {option_id} has no image"
        )));
    }

    // The mime comes from the constrained set the service accepts on write;
    // anything else falls back to a generic binary type rather than failing.
    let content_type = match mime.as_str() {
        "image/svg+xml" => "image/svg+xml",
        "image/webp" => "image/webp",
        "image/png" => "image/png",
        "image/jpeg" => "image/jpeg",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, no-cache"),
            (
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
            ),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response())
}
