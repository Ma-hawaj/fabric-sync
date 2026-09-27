use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::types::DefaultLocation;

/// One flat row: the stored default plus the branch columns joined in for
/// display. `default_location_id` is non-null exactly when a preference row
/// exists and sets it; the branch columns are non-null exactly when that id
/// still resolves (the FK is `ON DELETE SET NULL`, so they always agree, but
/// the reader below doesn't assume it).
#[derive(Debug, sqlx::FromRow)]
pub struct PreferenceRow {
    pub default_location_id: Option<Uuid>,
    pub branch_name: Option<String>,
    pub receives_orders: Option<bool>,
    pub holds_stock: Option<bool>,
    pub is_active: Option<bool>,
}

/// What the validation read needs: whether the referenced branch exists and
/// is still active.
#[derive(Debug, sqlx::FromRow)]
pub struct BranchStatus {
    pub is_active: bool,
}

impl PreferenceRow {
    pub fn into_preferences(self) -> super::types::Preferences {
        let default_location = match (
            self.default_location_id,
            self.branch_name,
            self.receives_orders,
            self.holds_stock,
            self.is_active,
        ) {
            (Some(id), Some(name), Some(receives_orders), Some(holds_stock), Some(is_active)) => {
                Some(DefaultLocation {
                    id,
                    name,
                    receives_orders,
                    holds_stock,
                    is_active,
                })
            }
            _ => None,
        };

        super::types::Preferences {
            // A dangling id with no branch row behind it (shouldn't happen
            // under the FK, but a defensive read costs nothing) reports as
            // unset rather than as an id the UI can't resolve.
            default_location_id: default_location.as_ref().map(|location| location.id),
            default_location,
        }
    }
}

// The dummy `u` row keeps this a single-row result even when the user has
// never saved preferences — missing row reads as "no default", not 404.
pub async fn get_preferences(state: &AppState, user_id: &str) -> Result<PreferenceRow, AppError> {
    sqlx::query_as!(
        PreferenceRow,
        r#"
        SELECT
            p.default_location_id AS "default_location_id?",
            b.name AS "branch_name?",
            b.receives_orders AS "receives_orders?",
            b.holds_stock AS "holds_stock?",
            b.is_active AS "is_active?"
        FROM (SELECT $1::TEXT AS user_id) AS u
        LEFT JOIN user_preferences p ON p.user_id = u.user_id
        LEFT JOIN branch b ON b.id = p.default_location_id
        "#,
        user_id,
    )
    .fetch_one(state.db())
    .await
    .map_err(AppError::from)
}

pub async fn branch_status(
    state: &AppState,
    location_id: Uuid,
) -> Result<Option<BranchStatus>, AppError> {
    sqlx::query_as!(
        BranchStatus,
        r#"SELECT is_active FROM branch WHERE id = $1"#,
        location_id,
    )
    .fetch_optional(state.db())
    .await
    .map_err(AppError::from)
}

pub async fn upsert_default_location(
    state: &AppState,
    user_id: &str,
    location_id: Option<Uuid>,
) -> Result<(), AppError> {
    sqlx::query!(
        r#"
        INSERT INTO user_preferences (user_id, default_location_id, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (user_id)
        DO UPDATE SET default_location_id = EXCLUDED.default_location_id, updated_at = now()
        "#,
        user_id,
        location_id,
    )
    .execute(state.db())
    .await
    .map_err(AppError::from)?;

    Ok(())
}
