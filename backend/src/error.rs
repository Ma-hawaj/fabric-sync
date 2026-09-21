use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug)]
pub enum AppError {
    Auth(String),
    Unauthorized(String),
    Io(std::io::Error),
    Sqlx(sqlx::Error),
    Migration(sqlx::migrate::MigrateError),
    NotFound(String),
    Conflict(String),
    BadRequest(String),
    /// The invoice document template failed to load or render. A server fault
    /// like the others above it, but worth its own variant because the
    /// template can be replaced at runtime (INVOICE_TEMPLATE_DIR), so this is
    /// the one 500 an operator can cause — and fix — without a deploy.
    Template(String),
    /// A per-request call to Zitadel's Users API failed (token exchange,
    /// network error, or an unexpected response shape) — a 500, but distinct
    /// from `Auth`, which is boot-time OIDC-discovery failure only.
    Zitadel(String),
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        // Postgres error code 23505 is `unique_violation` — surface it as a
        // 409 with a message clients can show, rather than a generic 500.
        if let sqlx::Error::Database(db_error) = &error {
            if db_error.code().as_deref() == Some("23505") {
                return Self::Conflict("a record with these values already exists".to_string());
            }

            // 23503 is `foreign_key_violation` — the client referenced an id
            // that doesn't exist (e.g. an unknown customer or material), which
            // is a bad request rather than a server fault.
            if db_error.code().as_deref() == Some("23503") {
                return Self::BadRequest("a referenced record does not exist".to_string());
            }
        }

        Self::Sqlx(error)
    }
}

impl From<minijinja::Error> for AppError {
    fn from(error: minijinja::Error) -> Self {
        // minijinja's Display is a one-liner; the chained cause carries the
        // line number and the failing expression, which is the half that
        // actually tells you what to fix in the template.
        let mut message = error.to_string();
        let mut source = std::error::Error::source(&error);
        while let Some(cause) = source {
            message.push_str(&format!(": {cause}"));
            source = cause.source();
        }

        Self::Template(message)
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(error: sqlx::migrate::MigrateError) -> Self {
        Self::Migration(error)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Auth(error) => (StatusCode::INTERNAL_SERVER_ERROR, error),
            Self::Unauthorized(message) => (StatusCode::UNAUTHORIZED, message),
            Self::Io(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::Sqlx(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::Migration(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Template(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
            Self::Zitadel(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };

        // Folded into the canonical "request completed" line (see
        // request_log::log_request) as a field — `status` isn't recorded
        // here since request_log already reads it off the final response for
        // every request, and tracing-subscriber's default fmt layer appends
        // rather than overwrites on a second `record()` of the same field.
        tracing::Span::current().record("error", message.as_str());

        // A field on the summary line isn't enough on its own: that line is
        // always INFO, so there'd be no way to filter or alert on errors by
        // level. Every AppError gets its own leveled event here instead — a
        // real server fault (5xx) is `error!`, an expected client-caused one
        // (401/404/409/400) is `warn!`.
        if status.is_server_error() {
            tracing::error!(status = status.as_u16(), error = %message, "request failed");
        } else {
            tracing::warn!(status = status.as_u16(), error = %message, "request rejected");
        }

        (status, message).into_response()
    }
}
