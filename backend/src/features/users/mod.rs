mod handlers;
mod routes;
// Shared with the orders feature, which resolves a stage assignee's display
// name against this list rather than trusting whatever a client sends.
pub(crate) mod service;
pub(crate) mod types;

pub use routes::router;
