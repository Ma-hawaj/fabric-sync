mod handlers;
mod routes;
// Shared with the invoice and order document renderers, which resolve a
// stored design slug to its label plus illustration rather than trusting the
// compiled-in catalog alone.
pub(crate) mod repository;
pub(crate) mod service;
pub(crate) mod types;

pub use routes::{public_router, router};
