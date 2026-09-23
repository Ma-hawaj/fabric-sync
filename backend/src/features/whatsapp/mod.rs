mod handlers;
mod routes;
// Shared with `state`, which builds the client from config at boot.
pub(crate) mod service;
mod types;

pub use routes::router;
