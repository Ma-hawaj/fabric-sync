pub(crate) mod designs;
pub(crate) mod document;
mod handlers;
mod routes;
pub(crate) mod service;
// Shared with the orders feature: PaymentType for the payments recorded when
// orders are collected, and the repository for validating and inserting those
// payments against the invoice's ledger.
pub(crate) mod repository;
pub(crate) mod types;

pub use routes::router;

#[cfg(test)]
mod material_sale_tests;
