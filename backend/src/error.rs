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
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
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
        };

        (status, message).into_response()
    }
}
