use super::{repository, service, types::*, worker};
use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn prepare(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(invoice_id): Path<Uuid>,
    Json(input): Json<PrepareInput>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(
        service::prepare(&state, invoice_id, input, user.subject().unwrap_or("staff")).await?,
    ))
}
pub async fn get(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(service::get(&state, id).await?))
}
pub async fn discard_preview(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    service::discard_preview(&state, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn history(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<History>>, AppError> {
    Ok(Json(repository::history(state.db(), id).await?))
}
pub async fn send(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<SendInput>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(
        service::approve(&state, id, input, user.subject().unwrap_or("staff"), true).await?,
    ))
}
pub async fn selection(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<SendInput>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(
        service::approve(&state, id, input, user.subject().unwrap_or("staff"), false).await?,
    ))
}
pub async fn cancel(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(service::cancel(&state, id).await?))
}
pub async fn resend(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<ResendInput>,
) -> Result<Json<Notification>, AppError> {
    Ok(Json(
        service::resend(
            &state,
            id,
            input.request_id,
            user.subject().unwrap_or("staff"),
        )
        .await?,
    ))
}

pub async fn document(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<DocumentMetadata>, AppError> {
    let artifact_id = service::document(&state, id).await?;
    Ok(Json(
        repository::artifact_metadata(state.db(), artifact_id).await?,
    ))
}
pub async fn metadata(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<DocumentMetadata>, AppError> {
    Ok(Json(repository::artifact_metadata(state.db(), id).await?))
}
pub async fn content(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    let (filename, bytes) = repository::artifact_content(state.db(), id).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{filename}\""),
            ),
            (header::CACHE_CONTROL, "private, no-store".into()),
        ],
        bytes,
    )
        .into_response())
}
pub async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    let config = state.notifications();
    Json(
        json!({"canSend":config.can_send(),"canRender":config.renderer_url.is_some(),"language":config.language}),
    )
}
#[derive(Deserialize)]
pub struct Challenge {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}
pub async fn verify(
    State(state): State<AppState>,
    Query(query): Query<Challenge>,
) -> Result<String, AppError> {
    if query.mode != "subscribe"
        || !worker::valid_verification_token(
            state.notifications().verification_token.as_deref(),
            &query.token,
        )
    {
        return Err(AppError::Unauthorized(
            "Invalid webhook verification token.".into(),
        ));
    }
    Ok(query.challenge)
}
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let secret =
        state.notifications().app_secret.as_deref().ok_or_else(|| {
            AppError::Unavailable("Webhook verification is not configured.".into())
        })?;
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !worker::valid_signature(secret, &body, signature) {
        return Err(AppError::Unauthorized("Invalid webhook signature.".into()));
    }
    worker::receive_webhook(state.db(), &body).await?;
    Ok(StatusCode::OK)
}
