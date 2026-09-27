mod designs;
mod document;
mod handlers;
mod routes;
pub(crate) mod service;
// Shared with the orders feature: PaymentType for the payments recorded when
// orders are received, and the repository for validating and inserting those
// payments against the invoice's ledger.
pub(crate) mod repository;
pub(crate) mod types;

pub use routes::router;
