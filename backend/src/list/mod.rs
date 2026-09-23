//! Shared server-side pagination, filtering and sorting for list endpoints.
//!
//! A feature opts in by declaring a [`ListSpec`] — its existing `SELECT` plus
//! the public field names that may be filtered or sorted — and calling
//! [`fetch_page`]. Nothing about filtering or paging is written per endpoint.
//!
//! The query-string contract mirrors the frontend's filter DSL exactly
//! (`frontend/src/config/data-table.ts`), so table state can be forwarded
//! without translation:
//!
//! ```text
//! ?page=1&perPage=10
//! &sort=[{"id":"date","desc":true}]
//! &filters=[{"id":"name","value":"ali","variant":"text","operator":"iLike"}]
//! &joinOperator=and
//! ```
//!
//! Omitting `perPage` returns every row rather than defaulting to a page size.
//! That keeps the form pickers — which need a whole table to populate a combobox
//! — working against the same endpoints, and makes truncation something a caller
//! asks for rather than something that happens quietly. An explicit `perPage` is
//! clamped to [`params::MAX_PER_PAGE`].

mod columns;
mod page;
mod params;
mod sql;

pub use columns::{ColumnDef, ColumnKind, ListSpec};
pub use page::{fetch_by_id, fetch_page, Page};
pub use params::ListParams;
