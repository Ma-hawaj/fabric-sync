use crate::error::AppError;

/// How a column's values are compared. This — not the client-supplied
/// `variant` — decides which operators are legal and how a filter's text is
/// parsed into a bind parameter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnKind {
    Text,
    Number,
    Date,
    Bool,
    Uuid,
    /// A Postgres `text[]`, filtered with array overlap rather than equality.
    TextArray,
}

#[derive(Clone, Copy, Debug)]
pub struct ColumnDef {
    /// The name of a column in the wrapped query's output. Always a fixed
    /// string from this registry — never anything a client sent.
    pub sql: &'static str,
    pub kind: ColumnKind,
}

impl ColumnDef {
    pub const fn new(sql: &'static str, kind: ColumnKind) -> Self {
        Self { sql, kind }
    }
}

/// Everything the shared list layer needs to know about one endpoint: the query
/// to wrap, which public field names may be filtered or sorted, and the tie
/// breaker that keeps paging stable.
pub struct ListSpec {
    /// The feature's existing `SELECT`, with its trailing `ORDER BY` removed —
    /// ordering is applied outside the wrapper.
    pub base_sql: &'static str,
    /// Public field name (as the frontend column id spells it) to column.
    pub columns: &'static [(&'static str, ColumnDef)],
    /// Appended after any client sort so the order is total; without it, rows
    /// that tie on the sorted column can swap between pages.
    pub default_order: &'static str,
}

impl ListSpec {
    /// Resolves a client-supplied field name against the whitelist. This is the
    /// single point where a client string could otherwise reach SQL as an
    /// identifier, so every path into the builder goes through here.
    pub fn column(&self, id: &str) -> Result<ColumnDef, AppError> {
        self.columns
            .iter()
            .find(|(name, _)| *name == id)
            .map(|(_, def)| *def)
            .ok_or_else(|| AppError::BadRequest(format!("unknown column `{id}`")))
    }
}
