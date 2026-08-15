use axum::{
    async_trait,
    extract::{FromRequestParts, Query},
    http::request::Parts,
};
use serde::Deserialize;

use crate::error::AppError;

/// Upper bound on an explicitly requested page size. A client asking for more
/// gets this many rows rather than an error, so a stray `perPage` can't be used
/// to pull the whole table through a paginated endpoint.
pub const MAX_PER_PAGE: i64 = 200;

/// The shape of a filter's target column, as declared by the frontend's
/// `column.meta.variant`. It travels with every filter so the server can reject
/// nonsense (a `isBetween` on a boolean) without knowing the column.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilterVariant {
    Text,
    Number,
    Range,
    Date,
    DateRange,
    Boolean,
    Select,
    MultiSelect,
}

/// Mirrors `dataTableConfig.operators` in `frontend/src/config/data-table.ts`.
/// serde's camelCase rule lowercases only the leading character of each variant,
/// which is exactly the wire spelling the frontend emits (`iLike`, `notILike`,
/// `inArray`, …) — `operator_names_match_the_frontend_dsl` pins that down.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    ILike,
    NotILike,
    Eq,
    Ne,
    InArray,
    NotInArray,
    IsEmpty,
    IsNotEmpty,
    Lt,
    Lte,
    Gt,
    Gte,
    IsBetween,
    IsRelativeToToday,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JoinOperator {
    #[default]
    And,
    Or,
}

impl JoinOperator {
    pub fn sql(self) -> &'static str {
        match self {
            Self::And => " AND ",
            Self::Or => " OR ",
        }
    }
}

/// A filter value arrives as either a scalar or a list — `multiSelect` sends a
/// list, `isBetween` sends a two-element list, everything else sends a scalar.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum FilterValue {
    One(String),
    Many(Vec<String>),
}

impl Default for FilterValue {
    fn default() -> Self {
        Self::One(String::new())
    }
}

impl FilterValue {
    /// The scalar reading of a value. A single-element list reads as its element
    /// so a `select` filter works whether the client sent `"paid"` or `["paid"]`.
    pub fn as_one(&self) -> Result<&str, AppError> {
        match self {
            Self::One(value) => Ok(value),
            Self::Many(values) if values.len() == 1 => Ok(&values[0]),
            Self::Many(_) => Err(AppError::BadRequest(
                "this filter takes a single value".to_string(),
            )),
        }
    }

    /// The list reading of a value. A scalar reads as a one-element list.
    pub fn as_many(&self) -> Vec<String> {
        match self {
            Self::One(value) => vec![value.clone()],
            Self::Many(values) => values.clone(),
        }
    }

    /// The two bounds of an `isBetween` value. Either side may be blank, which
    /// means "unbounded on this side" — the slider and date-range controls both
    /// emit a half-open range that way.
    pub fn as_pair(&self) -> Result<(Option<&str>, Option<&str>), AppError> {
        match self {
            Self::Many(values) if values.len() == 2 => Ok((
                blank_to_none(values[0].as_str()),
                blank_to_none(values[1].as_str()),
            )),
            _ => Err(AppError::BadRequest(
                "a between filter takes exactly two values".to_string(),
            )),
        }
    }
}

/// An unbounded side of a range arrives as an empty string rather than being
/// omitted, so it has to be distinguished from a real empty-string bound.
fn blank_to_none(value: &str) -> Option<&str> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterItem {
    pub id: String,
    #[serde(default)]
    pub value: FilterValue,
    pub variant: FilterVariant,
    pub operator: FilterOperator,
    // `filterId` is the frontend's React key for the filter row. It is accepted
    // so the URL state can be forwarded verbatim, and deliberately ignored.
}

#[derive(Clone, Debug, Deserialize)]
pub struct SortItem {
    pub id: String,
    #[serde(default)]
    pub desc: bool,
}

/// The raw query string, before validation. `sort` and `filters` are JSON
/// documents rather than repeated params because that is what nuqs writes.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawListParams {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub sort: Option<String>,
    pub filters: Option<String>,
    pub join_operator: Option<JoinOperator>,
}

#[derive(Clone, Debug, Default)]
pub struct ListParams {
    pub page: i64,
    /// `None` means "no limit" — see the module docs on why an absent `perPage`
    /// returns everything rather than defaulting to a page size.
    pub per_page: Option<i64>,
    pub sort: Vec<SortItem>,
    pub filters: Vec<FilterItem>,
    pub join: JoinOperator,
}

impl ListParams {
    pub fn offset(&self) -> i64 {
        match self.per_page {
            Some(per_page) => (self.page - 1) * per_page,
            None => 0,
        }
    }

    /// The page size to report back to the client. Unpaginated requests report
    /// the total, so `pageCount` is 1 and the client sees one full page.
    pub fn effective_per_page(&self, total: i64) -> i64 {
        self.per_page.unwrap_or(total)
    }

    pub fn page_count(&self, total: i64) -> i64 {
        match self.per_page {
            // `i64::div_ceil` is still unstable, and both operands are known
            // positive here, so the rounding is done by hand.
            Some(per_page) => (total + per_page - 1) / per_page,
            None => 1,
        }
    }
}

/// The whole of the parsing and validation, as one pure function so it can be
/// tested without standing up a request.
pub fn parse(raw: RawListParams) -> Result<ListParams, AppError> {
    let page = raw.page.unwrap_or(1);
    if page < 1 {
        return Err(AppError::BadRequest("page must be at least 1".to_string()));
    }

    let per_page = match raw.per_page {
        Some(per_page) if per_page < 1 => {
            return Err(AppError::BadRequest(
                "perPage must be at least 1".to_string(),
            ))
        }
        Some(per_page) => Some(per_page.min(MAX_PER_PAGE)),
        None => None,
    };

    let sort = parse_json_param(raw.sort.as_deref(), "sort")?;
    let filters = parse_json_param(raw.filters.as_deref(), "filters")?;

    Ok(ListParams {
        page,
        per_page,
        sort,
        filters,
        join: raw.join_operator.unwrap_or_default(),
    })
}

fn parse_json_param<T: for<'de> Deserialize<'de>>(
    raw: Option<&str>,
    name: &str,
) -> Result<Vec<T>, AppError> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(Vec::new());
    };

    serde_json::from_str(raw)
        .map_err(|error| AppError::BadRequest(format!("invalid `{name}` parameter: {error}")))
}

#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for ListParams {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // Deliberately not `Query<ListParams>`: a `Query` rejection renders its
        // own response and would bypass `AppError`, so the raw form is extracted
        // first and every failure after that is an `AppError::BadRequest`.
        let Query(raw) = Query::<RawListParams>::from_request_parts(parts, state)
            .await
            .map_err(|error| AppError::BadRequest(error.body_text()))?;

        parse(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(query: &str) -> RawListParams {
        serde_urlencoded::from_str(query).unwrap()
    }

    #[test]
    fn an_empty_query_string_is_an_unpaginated_first_page() {
        let params = parse(raw("")).unwrap();

        assert_eq!(params.page, 1);
        assert_eq!(params.per_page, None);
        assert_eq!(params.offset(), 0);
        assert_eq!(params.page_count(37), 1);
        assert_eq!(params.effective_per_page(37), 37);
        assert!(params.sort.is_empty());
        assert!(params.filters.is_empty());
        assert_eq!(params.join, JoinOperator::And);
    }

    #[test]
    fn page_and_per_page_drive_the_offset() {
        let params = parse(raw("page=3&perPage=10")).unwrap();

        assert_eq!(params.offset(), 20);
        assert_eq!(params.page_count(37), 4);
        assert_eq!(params.effective_per_page(37), 10);
    }

    #[test]
    fn page_count_is_zero_when_nothing_matches() {
        let params = parse(raw("page=1&perPage=10")).unwrap();

        assert_eq!(params.page_count(0), 0);
    }

    #[test]
    fn per_page_is_clamped_rather_than_rejected() {
        let params = parse(raw("perPage=99999")).unwrap();

        assert_eq!(params.per_page, Some(MAX_PER_PAGE));
    }

    #[test]
    fn out_of_range_paging_is_rejected() {
        for query in ["page=0", "page=-1", "perPage=0", "perPage=-5"] {
            let error = parse(raw(query)).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{query:?}");
        }
    }

    #[test]
    fn sort_and_filters_parse_the_json_the_frontend_serializes() {
        let params = parse(raw(
            "sort=%5B%7B%22id%22%3A%22name%22%2C%22desc%22%3Atrue%7D%5D\
             &filters=%5B%7B%22id%22%3A%22name%22%2C%22value%22%3A%22ali%22\
             %2C%22variant%22%3A%22text%22%2C%22operator%22%3A%22iLike%22\
             %2C%22filterId%22%3A%22abc%22%7D%5D&joinOperator=or",
        ))
        .unwrap();

        assert_eq!(params.sort.len(), 1);
        assert_eq!(params.sort[0].id, "name");
        assert!(params.sort[0].desc);

        assert_eq!(params.filters.len(), 1);
        assert_eq!(params.filters[0].id, "name");
        assert_eq!(params.filters[0].variant, FilterVariant::Text);
        assert_eq!(params.filters[0].operator, FilterOperator::ILike);
        assert_eq!(params.filters[0].value, FilterValue::One("ali".to_string()));

        assert_eq!(params.join, JoinOperator::Or);
    }

    #[test]
    fn operator_names_match_the_frontend_dsl() {
        let cases = [
            ("iLike", FilterOperator::ILike),
            ("notILike", FilterOperator::NotILike),
            ("eq", FilterOperator::Eq),
            ("ne", FilterOperator::Ne),
            ("inArray", FilterOperator::InArray),
            ("notInArray", FilterOperator::NotInArray),
            ("isEmpty", FilterOperator::IsEmpty),
            ("isNotEmpty", FilterOperator::IsNotEmpty),
            ("lt", FilterOperator::Lt),
            ("lte", FilterOperator::Lte),
            ("gt", FilterOperator::Gt),
            ("gte", FilterOperator::Gte),
            ("isBetween", FilterOperator::IsBetween),
            ("isRelativeToToday", FilterOperator::IsRelativeToToday),
        ];

        for (wire, expected) in cases {
            let parsed: FilterOperator =
                serde_json::from_str(&format!("\"{wire}\"")).unwrap_or_else(|_| panic!("{wire}"));
            assert_eq!(parsed, expected, "{wire}");
        }
    }

    #[test]
    fn variant_names_match_the_frontend_dsl() {
        let cases = [
            ("text", FilterVariant::Text),
            ("number", FilterVariant::Number),
            ("range", FilterVariant::Range),
            ("date", FilterVariant::Date),
            ("dateRange", FilterVariant::DateRange),
            ("boolean", FilterVariant::Boolean),
            ("select", FilterVariant::Select),
            ("multiSelect", FilterVariant::MultiSelect),
        ];

        for (wire, expected) in cases {
            let parsed: FilterVariant =
                serde_json::from_str(&format!("\"{wire}\"")).unwrap_or_else(|_| panic!("{wire}"));
            assert_eq!(parsed, expected, "{wire}");
        }
    }

    #[test]
    fn malformed_json_is_a_bad_request_rather_than_a_panic() {
        for query in ["sort=not-json", "filters=%7B%7D", "filters=%5B%7B%7D%5D"] {
            let error = parse(raw(query)).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{query:?}");
        }
    }

    #[test]
    fn blank_json_params_are_treated_as_absent() {
        let params = parse(raw("sort=&filters=")).unwrap();

        assert!(params.sort.is_empty());
        assert!(params.filters.is_empty());
    }

    #[test]
    fn filter_values_read_as_scalars_or_lists() {
        let one = FilterValue::One("paid".to_string());
        let many = FilterValue::Many(vec!["paid".to_string(), "partial".to_string()]);
        let single = FilterValue::Many(vec!["paid".to_string()]);

        assert_eq!(one.as_one().unwrap(), "paid");
        assert_eq!(single.as_one().unwrap(), "paid");
        assert!(many.as_one().is_err());

        assert_eq!(one.as_many(), vec!["paid".to_string()]);
        assert_eq!(many.as_many().len(), 2);
    }

    #[test]
    fn a_between_value_allows_an_open_side() {
        let both = FilterValue::Many(vec!["10".to_string(), "500".to_string()]);
        assert_eq!(both.as_pair().unwrap(), (Some("10"), Some("500")));

        let open_upper = FilterValue::Many(vec!["10".to_string(), "".to_string()]);
        assert_eq!(open_upper.as_pair().unwrap(), (Some("10"), None));

        let open_lower = FilterValue::Many(vec!["  ".to_string(), "500".to_string()]);
        assert_eq!(open_lower.as_pair().unwrap(), (None, Some("500")));

        assert!(FilterValue::One("10".to_string()).as_pair().is_err());
    }
}
