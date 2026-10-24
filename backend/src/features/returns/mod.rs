mod handlers;
pub(crate) mod repository;
mod routes;
pub(crate) mod service;
pub(crate) mod types;

pub use routes::router;

#[cfg(test)]
mod restock_tests;
#[cfg(test)]
mod tests;
