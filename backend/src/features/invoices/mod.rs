mod handlers;
mod repository;
mod routes;
mod service;
// Shared with the orders feature, which reuses PaymentType for the final
// payment recorded when an order is received.
pub(crate) mod types;

pub use routes::router;
