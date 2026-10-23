use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One row of GET /design-options — a single choice inside one of the fixed
/// order design slots (thobe type, collar, sleeve, front pocket, patti, EMD).
/// The slots themselves stay fixed columns on `orders`; only the options are
/// rows, which is why staff can add and retire these without a deploy.
///
/// `slug` is the stored identity: an order keeps the bare slug as TEXT (no
/// foreign key), so a slug is immutable once created — renaming it would
/// orphan the orders that already stored it. `label` is the display text and
/// is free to change.
#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DesignOption {
    pub id: Uuid,
    pub category: String,
    pub slug: String,
    pub label: String,
    pub cost: f64,
    /// Position inside its category picker. Gaps are fine; only the relative
    /// order matters.
    pub sort_order: i32,
    pub is_active: bool,
    /// Whether an illustration is stored. The list never carries the bytes —
    /// the picker loads them from `image_url`, and the printed documents look
    /// them up directly.
    pub has_image: bool,
    /// Where the illustration is served from (`GET /design-options/:id/image`,
    /// public — an `<img>` can't carry a bearer token).
    pub image_url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDesignOptionInput {
    pub category: String,
    pub slug: String,
    pub label: String,
    #[serde(default)]
    pub cost: f64,
    #[serde(default)]
    pub sort_order: Option<i32>,
    /// An optional `data:image/<svg|webp|png|jpeg>;base64,...` URL. Sent as JSON
    /// rather than multipart so no extra extractor is needed.
    #[serde(default)]
    pub image_data_url: Option<String>,
}

/// Every field is optional so the same endpoint serves the edit form (which
/// sends all of them) and the list page's activate/deactivate action (which
/// sends only `isActive`). `image_data_url` is three-state: absent leaves the
/// illustration untouched, `null` clears it, a data URL replaces it. There is
/// deliberately no `slug`/`category` here — those are the stored identity (see
/// above) and can't change after creation.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDesignOptionInput {
    pub cost: Option<f64>,
    pub label: Option<String>,
    pub sort_order: Option<i32>,
    pub is_active: Option<bool>,
    #[serde(default)]
    pub image_data_url: Option<Option<String>>,
}

/// One catalog row as the printed documents need it: the display label plus
/// the illustration bytes when one was uploaded (also see the fallback in the
/// document renderers for rows that carry none yet).
#[derive(Clone, Debug)]
pub struct DesignAsset {
    pub category: String,
    pub slug: String,
    pub label: String,
    pub image: Option<Vec<u8>>,
    pub image_mime: String,
}
