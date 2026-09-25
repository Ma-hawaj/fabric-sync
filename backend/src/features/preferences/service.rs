use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError, state::AppState};

use super::{
    repository::{self, BranchStatus},
    types::{Preferences, UpdatePreferencesInput},
};

/// The storage key for a caller's preferences. Users live in Zitadel, not in
/// a local table, so the introspected subject is the identity; the client_id
/// fallback covers machine tokens without a subject, and `dev` covers the
/// AUTH_DISABLED escape hatch — every local dev call shares one row, which is
/// fine for a personal default on a throwaway database.
pub fn preference_key(user: &AuthenticatedUser) -> &str {
    user.subject().or_else(|| user.client_id()).unwrap_or("dev")
}

// The testable seam: what a stored default is allowed to point at. Clearing
// (None) always succeeds; an id must resolve to a branch that is still
// active. Capability flags are deliberately not checked here — one default
// feeds both receiving and stock pickers, and each picker decides
// applicability client-side (see location-filters.ts).
fn validate_default_location(
    location_id: Option<Uuid>,
    branch: Option<&BranchStatus>,
) -> Result<(), AppError> {
    match (location_id, branch) {
        (None, _) => Ok(()),
        (Some(_), None) => Err(AppError::NotFound("location not found".to_string())),
        (Some(_), Some(branch)) if !branch.is_active => Err(AppError::BadRequest(
            "the default location is deactivated".to_string(),
        )),
        (Some(_), Some(_)) => Ok(()),
    }
}

pub async fn get_preferences(
    state: &AppState,
    user: &AuthenticatedUser,
) -> Result<Preferences, AppError> {
    let row = repository::get_preferences(state, preference_key(user)).await?;

    Ok(row.into_preferences())
}

pub async fn update_preferences(
    state: &AppState,
    user: &AuthenticatedUser,
    input: UpdatePreferencesInput,
) -> Result<Preferences, AppError> {
    let branch = match input.default_location_id {
        Some(location_id) => repository::branch_status(state, location_id).await?,
        None => None,
    };
    validate_default_location(input.default_location_id, branch.as_ref())?;

    let key = preference_key(user).to_string();
    repository::upsert_default_location(state, &key, input.default_location_id).await?;

    let row = repository::get_preferences(state, &key).await?;

    tracing::info!(
        user_id = %key,
        default_location_id = ?input.default_location_id,
        "preferences updated"
    );

    Ok(row.into_preferences())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clearing_the_default_always_succeeds() {
        assert!(validate_default_location(None, None).is_ok());
    }

    #[test]
    fn an_unknown_location_is_not_found() {
        let error = validate_default_location(Some(Uuid::nil()), None).unwrap_err();
        assert!(matches!(error, AppError::NotFound(_)));
    }

    #[test]
    fn a_deactivated_location_is_rejected() {
        let error =
            validate_default_location(Some(Uuid::nil()), Some(&BranchStatus { is_active: false }))
                .unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn an_active_location_is_accepted() {
        assert!(validate_default_location(
            Some(Uuid::nil()),
            Some(&BranchStatus { is_active: true }),
        )
        .is_ok());
    }
}
