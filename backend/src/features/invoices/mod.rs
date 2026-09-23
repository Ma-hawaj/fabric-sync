mod designs;
mod document;
mod handlers;
mod repository;
mod routes;
// The whatsapp feature calls `get_invoice` to rebuild the caption from the
// stored row rather than trusting the client.
pub(crate) mod service;
// Shared with the orders feature, which reuses PaymentType for the final
// payment recorded when an order is received.
pub(crate) mod types;

pub use routes::router;
