use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{DesignAsset, DesignOption};

// The illustration bytes are deliberately absent here: the list carries only
// `has_image` plus the URL that serves them, so the admin table and the
// pickers stay small. `image_url` is computed in SQL because `fetch_page`
// decodes rows straight into `DesignOption` with no post-processing hook.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            id,
            category,
            slug,
            label,
            cost::float8 AS cost,
            sort_order,
            is_active,
            (image IS NOT NULL) AS has_image,
            ('/design-options/' || id::text || '/image?v=' || image_version::text) AS image_url
        FROM design_options
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("category", ColumnDef::new("category", ColumnKind::Text)),
        ("slug", ColumnDef::new("slug", ColumnKind::Text)),
        ("label", ColumnDef::new("label", ColumnKind::Text)),
        (
            "sortOrder",
            ColumnDef::new("sort_order", ColumnKind::Number),
        ),
        ("isActive", ColumnDef::new("is_active", ColumnKind::Bool)),
        ("hasImage", ColumnDef::new("has_image", ColumnKind::Bool)),
    ],
    default_order: "category ASC, sort_order ASC, label ASC",
};

// Returns retired options too — the admin page lists them behind a status
// filter, and the pickers narrow to the active ones client-side.
pub async fn list_options(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<DesignOption>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn create_option(
    state: &AppState,
    category: &str,
    slug: &str,
    label: &str,
    sort_order: i32,
    image: Option<&[u8]>,
    image_mime: &str,
    cost: f64,
) -> Result<DesignOption, sqlx::Error> {
    sqlx::query_as!(
        DesignOption,
        r#"
        INSERT INTO design_options (category, slug, label, sort_order, image, image_mime, cost)
        VALUES ($1, $2, $3, $4, $5, $6, $7::float8)
        RETURNING id, category, slug, label, sort_order, is_active, cost::float8 AS "cost!",
            (image IS NOT NULL) AS "has_image!",
            ('/design-options/' || id::text || '/image?v=' || image_version::text) AS "image_url!"
        "#,
        category,
        slug,
        label,
        sort_order,
        image,
        image_mime,
        cost,
    )
    .fetch_one(state.db())
    .await
}

// COALESCE leaves any field the caller omitted untouched, so a partial update
// (e.g. just `is_active`) stays a single statement rather than a
// read-modify-write. The illustration is three-state via `touch_image`: false
// leaves it alone, true writes `image` (NULL clears it).
#[allow(clippy::too_many_arguments)]
pub async fn update_option(
    state: &AppState,
    option_id: Uuid,
    label: Option<&str>,
    sort_order: Option<i32>,
    is_active: Option<bool>,
    touch_image: bool,
    image: Option<&[u8]>,
    image_mime: Option<&str>,
    cost: Option<f64>,
) -> Result<Option<DesignOption>, sqlx::Error> {
    sqlx::query_as!(
        DesignOption,
        r#"
        UPDATE design_options
        SET label = COALESCE($2, label),
            sort_order = COALESCE($3, sort_order),
            is_active = COALESCE($4, is_active),
            image = CASE WHEN $5 THEN $6 ELSE image END,
            image_mime = CASE WHEN $5 THEN COALESCE($7, image_mime) ELSE image_mime END,
            image_version = CASE WHEN $5 THEN image_version + 1 ELSE image_version END,
            cost = COALESCE($8::float8, cost)
        WHERE id = $1
        RETURNING id, category, slug, label, sort_order, is_active, cost::float8 AS "cost!",
            (image IS NOT NULL) AS "has_image!",
            ('/design-options/' || id::text || '/image?v=' || image_version::text) AS "image_url!"
        "#,
        option_id,
        label,
        sort_order,
        is_active,
        touch_image,
        image,
        image_mime,
        cost,
    )
    .fetch_optional(state.db())
    .await
}

pub async fn get_image(
    state: &AppState,
    option_id: Uuid,
) -> Result<Option<(Vec<u8>, String)>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT image, image_mime AS "image_mime!"
        FROM design_options
        WHERE id = $1
        "#,
        option_id,
    )
    .fetch_optional(state.db())
    .await?;

    Ok(row.and_then(|row| row.image.map(|image| (image, row.image_mime))))
}

/// The catalog rows the printed documents need for one invoice/order: every
/// stored design value resolved to its label plus illustration, in a single
/// batched query (the same batching pattern as `single_stock_locations`).
/// Values with no row simply miss from the map, and the documents fall back
/// to the compiled-in catalog and then to text-only — a legacy free-text
/// value like "Saudi" still prints.
pub async fn lookup_assets(
    state: &AppState,
    pairs: &[(String, String)],
) -> Result<Vec<DesignAsset>, sqlx::Error> {
    if pairs.is_empty() {
        return Ok(Vec::new());
    }

    let categories: Vec<String> = pairs.iter().map(|(category, _)| category.clone()).collect();
    let slugs: Vec<String> = pairs.iter().map(|(_, slug)| slug.clone()).collect();

    let rows = sqlx::query!(
        r#"
        SELECT category, slug, label, image, image_mime AS "image_mime!"
        FROM design_options
        WHERE (category, slug) IN (SELECT * FROM UNNEST($1::text[], $2::text[]))
        "#,
        &categories,
        &slugs,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| DesignAsset {
            category: row.category,
            slug: row.slug,
            label: row.label,
            image: row.image,
            image_mime: row.image_mime,
        })
        .collect())
}
