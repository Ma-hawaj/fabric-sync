use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug)]
pub enum AppError {
    Auth(String),
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
            Self::Io(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::Sqlx(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::Migration(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, message),
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Template(message) => (StatusCode::INTERNAL_SERVER_ERROR, message),
        };

        (status, message).into_response()
    }
}
