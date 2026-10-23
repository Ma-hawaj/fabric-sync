mod document;
mod handlers;
pub(crate) mod readiness;
mod readiness_repository;
mod repair_document;
mod repository;
mod routes;
mod service;
mod types;

pub use routes::router;
