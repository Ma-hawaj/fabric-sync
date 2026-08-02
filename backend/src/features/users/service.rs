use crate::{error::AppError, state::AppState};

use super::types::User;

fn user(id: &str, name: &str) -> User {
    User {
        id: id.to_string(),
        name: name.to_string(),
    }
}

/// Mocked until real auth is wired up, at which point this calls Zitadel's
/// user directory instead — see the discussion in `app.rs` about
/// `require_auth` being disabled. Shaped like that eventual response (an
/// opaque id plus a display name) so callers don't have to change when the
/// mock is replaced.
///
/// `_state` is unused today but kept in the signature: the real
/// implementation will need it for Zitadel's API URL and credentials.
pub async fn list_users(_state: &AppState) -> Result<Vec<User>, AppError> {
    Ok(vec![
        user("mock-user-1", "Ahmed Al-Sayed"),
        user("mock-user-2", "Fatima Al-Zahrani"),
        user("mock-user-3", "Yusuf Al-Mutairi"),
        user("mock-user-4", "Layla Al-Harthi"),
    ])
}
