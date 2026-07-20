mod handlers;
// Shared with the invoices feature, which creates customers and measurement
// snapshots inside its own transaction.
pub(crate) mod repository;
mod routes;
mod service;
pub(crate) mod types;

pub use routes::router;
