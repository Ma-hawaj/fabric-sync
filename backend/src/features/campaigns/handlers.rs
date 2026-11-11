use super::{provider, repository as store, service, types::*};
use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;
fn actor(user: &AuthenticatedUser) -> &str {
    user.subject().unwrap_or("staff")
}
pub async fn audience_count(
    State(s): State<AppState>,
    Json(filter): Json<AudienceFilter>,
) -> Result<Json<AudienceCount>, AppError> {
    Ok(Json(service::audience_count(&s, &filter).await?))
}
pub async fn capabilities(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(
        json!({"canSend":s.notifications().can_send()&&s.notifications().marketing_enabled,"canManageTemplates":s.notifications().waba_id.is_some()&&s.notifications().access_token.is_some(),"timezone":s.timezone()?.to_string()}),
    ))
}
pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<Pagination>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(store::campaigns(s.db(), &p).await?))
}
pub async fn get(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Campaign>, AppError> {
    Ok(Json(
        store::campaign(&mut *s.db().acquire().await?, id, false).await?,
    ))
}
pub async fn create(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Json(input): Json<CampaignInput>,
) -> Result<Json<Campaign>, AppError> {
    service::validate_campaign(&input)?;
    Ok(Json(
        store::save_campaign(s.db(), None, &input, actor(&u)).await?,
    ))
}
pub async fn update(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<CampaignInput>,
) -> Result<Json<Campaign>, AppError> {
    service::validate_campaign(&input)?;
    Ok(Json(
        store::save_campaign(s.db(), Some(id), &input, actor(&u)).await?,
    ))
}
pub async fn preview(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Preview>, AppError> {
    Ok(Json(service::preview(&s, id).await?))
}
pub async fn approve(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<ApproveInput>,
) -> Result<Json<Campaign>, AppError> {
    Ok(Json(service::approve(&s, id, input, actor(&u)).await?))
}
pub async fn cancel(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Campaign>, AppError> {
    Ok(Json(store::cancel(s.db(), id).await?))
}
pub async fn recipients(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
    Query(p): Query<Pagination>,
) -> Result<Json<Value>, AppError> {
    store::campaign(&mut *s.db().acquire().await?, id, false).await?;
    Ok(Json(store::recipients(s.db(), id, &p).await?))
}
pub async fn templates(State(s): State<AppState>) -> Result<Json<Vec<Template>>, AppError> {
    Ok(Json(store::templates(s.db()).await?))
}
pub async fn create_template(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Json(input): Json<TemplateInput>,
) -> Result<Json<Template>, AppError> {
    service::validate_template(&input)?;
    Ok(Json(
        store::save_template(s.db(), None, &input, actor(&u)).await?,
    ))
}
pub async fn update_template(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<TemplateInput>,
) -> Result<Json<Template>, AppError> {
    service::validate_template(&input)?;
    Ok(Json(
        store::save_template(s.db(), Some(id), &input, actor(&u)).await?,
    ))
}
pub async fn submit(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Template>, AppError> {
    Ok(Json(provider::submit(&s, id).await?))
}
pub async fn sync(State(s): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"synced":provider::sync(&s).await?})))
}
pub async fn archive(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    store::archive_template(s.db(), id).await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn consent(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(service::get_consent(&s, id).await?))
}
pub async fn save_consent(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(input): Json<ConsentInput>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(service::consent(&s, id, input, actor(&u)).await?))
}
pub async fn upload(
    State(s): State<AppState>,
    Extension(u): Extension<AuthenticatedUser>,
    Json(input): Json<AssetInput>,
) -> Result<Json<Asset>, AppError> {
    Ok(Json(service::upload(&s, input, actor(&u)).await?))
}
pub async fn asset(
    State(s): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let (a, b) = store::asset(&mut *s.db().acquire().await?, id).await?;
    Ok((
        [
            (header::CONTENT_TYPE, a.mime_type),
            (header::CACHE_CONTROL, "private, no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
        ],
        Bytes::from(b),
    ))
}
