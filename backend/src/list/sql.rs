use chrono::{DateTime, NaiveDate};
use uuid::Uuid;

use crate::error::AppError;

use super::{
    columns::{ColumnDef, ColumnKind, ListSpec},
    params::{FilterItem, FilterOperator, FilterValue, ListParams},
};

/// A value destined for a bind parameter. Filter text is parsed into one of
/// these up front so a malformed number or date is a 400 rather than a database
/// error, and so nothing a client sent is ever spliced into the statement.
#[derive(Clone, Debug, PartialEq)]
pub enum BindValue {
    Text(String),
    TextList(Vec<String>),
    Number(f64),
    Bool(bool),
    Date(NaiveDate),
    Uuid(Uuid),
    UuidList(Vec<Uuid>),
    Int(i64),
}

/// The statement and its bind values, in placeholder order.
#[derive(Clone, Debug, PartialEq)]
pub struct BuiltQuery {
    pub sql: String,
    pub binds: Vec<BindValue>,
}

/// Wraps a feature's query as a CTE and applies filtering, ordering and paging
/// to its output columns.
///
/// Working on the output rather than pushing predicates into the original query
/// is what lets one builder serve every endpoint: the `GROUP BY` + `json_agg`
/// shapes and the `LEFT JOIN LATERAL` shape all present as a flat row here. Each
/// base query already produces exactly one row per entity, so `LIMIT` over the
/// wrapper is a limit on entities. `count(*) OVER ()` carries the filtered total
/// on every row, which saves a second round trip for the count.
pub fn build(spec: &ListSpec, params: &ListParams) -> Result<BuiltQuery, AppError> {
    let mut binds = Vec::new();
    let mut sql = format!(
        "WITH base AS (\n{}\n)\nSELECT base.*, count(*) OVER () AS list_total\nFROM base",
        spec.base_sql.trim()
    );

    let predicates = params
        .filters
        .iter()
        .map(|filter| predicate(spec, filter, &mut binds))
        .collect::<Result<Vec<_>, _>>()?;

    if !predicates.is_empty() {
        sql.push_str("\nWHERE ");
        sql.push_str(&predicates.join(params.join.sql()));
    }

    sql.push_str("\nORDER BY ");
    for item in &params.sort {
        let column = spec.column(&item.id)?;
        sql.push_str(&format!(
            "{} {}, ",
            quote(column.sql),
            if item.desc { "DESC" } else { "ASC" }
        ));
    }
    sql.push_str(spec.default_order);

    if let Some(per_page) = params.per_page {
        binds.push(BindValue::Int(per_page));
        let limit = binds.len();
        binds.push(BindValue::Int(params.offset()));
        let offset = binds.len();
        sql.push_str(&format!("\nLIMIT ${limit} OFFSET ${offset}"));
    }

    Ok(BuiltQuery { sql, binds })
}

/// The single-row lookup that replaces each feature's hand-written
/// `WHERE id = $1` variant, so a base query is written once and serves both.
pub fn build_by_id(spec: &ListSpec, id: Uuid) -> Result<BuiltQuery, AppError> {
    let column = spec.column("id")?;

    Ok(BuiltQuery {
        sql: format!(
            "WITH base AS (\n{}\n)\nSELECT base.* FROM base WHERE {} = $1 LIMIT 1",
            spec.base_sql.trim(),
            quote(column.sql),
        ),
        binds: vec![BindValue::Uuid(id)],
    })
}

/// Identifiers come from the registry, never from a request, but they are still
/// quoted so a column named after a keyword can't change the parse.
fn quote(identifier: &str) -> String {
    format!("base.\"{identifier}\"")
}

fn predicate(
    spec: &ListSpec,
    filter: &FilterItem,
    binds: &mut Vec<BindValue>,
) -> Result<String, AppError> {
    let column = spec.column(&filter.id)?;
    let name = quote(column.sql);

    // Emptiness is the one comparison that never binds a value, and what counts
    // as empty depends on the column's shape.
    match filter.operator {
        FilterOperator::IsEmpty => return Ok(empty_predicate(&name, column.kind, true)),
        FilterOperator::IsNotEmpty => return Ok(empty_predicate(&name, column.kind, false)),
        FilterOperator::IsRelativeToToday => {
            return Err(AppError::BadRequest(
                "the `isRelativeToToday` operator is not supported".to_string(),
            ))
        }
        _ => {}
    }

    match column.kind {
        ColumnKind::TextArray => array_predicate(&name, filter, binds),
        ColumnKind::Bool => bool_predicate(&name, filter, binds),
        ColumnKind::Text | ColumnKind::Uuid => text_predicate(&name, column, filter, binds),
        ColumnKind::Number | ColumnKind::Date => scalar_predicate(&name, column, filter, binds),
    }
}

fn empty_predicate(name: &str, kind: ColumnKind, empty: bool) -> String {
    let test = match kind {
        ColumnKind::Text => format!("({name} IS NULL OR {name} = '')"),
        ColumnKind::TextArray => {
            format!("({name} IS NULL OR cardinality({name}) = 0)")
        }
        _ => format!("{name} IS NULL"),
    };

    if empty {
        test
    } else {
        format!("NOT {test}")
    }
}

fn array_predicate(
    name: &str,
    filter: &FilterItem,
    binds: &mut Vec<BindValue>,
) -> Result<String, AppError> {
    match filter.operator {
        // `&&` is array overlap: true when the row shares any element with the
        // selection, which is what "Has any of" means in the toolbar.
        FilterOperator::InArray | FilterOperator::Eq => {
            binds.push(BindValue::TextList(filter.value.as_many()));
            Ok(format!("{name} && ${}::text[]", binds.len()))
        }
        FilterOperator::NotInArray | FilterOperator::Ne => {
            binds.push(BindValue::TextList(filter.value.as_many()));
            Ok(format!("NOT ({name} && ${}::text[])", binds.len()))
        }
        FilterOperator::ILike => {
            binds.push(BindValue::Text(filter.value.as_one()?.to_string()));
            Ok(format!(
                "EXISTS (SELECT 1 FROM unnest({name}) AS element WHERE element ILIKE '%' || ${} || '%')",
                binds.len()
            ))
        }
        FilterOperator::NotILike => {
            binds.push(BindValue::Text(filter.value.as_one()?.to_string()));
            Ok(format!(
                "NOT EXISTS (SELECT 1 FROM unnest({name}) AS element WHERE element ILIKE '%' || ${} || '%')",
                binds.len()
            ))
        }
        other => Err(unsupported(other, ColumnKind::TextArray)),
    }
}

fn bool_predicate(
    name: &str,
    filter: &FilterItem,
    binds: &mut Vec<BindValue>,
) -> Result<String, AppError> {
    let operator = match filter.operator {
        FilterOperator::Eq => "=",
        FilterOperator::Ne => "IS DISTINCT FROM",
        other => return Err(unsupported(other, ColumnKind::Bool)),
    };

    let raw = filter.value.as_one()?;
    let value = match raw {
        "true" | "True" | "1" => true,
        "false" | "False" | "0" => false,
        other => {
            return Err(AppError::BadRequest(format!(
                "`{other}` is not a boolean value"
            )))
        }
    };

    binds.push(BindValue::Bool(value));
    Ok(format!("{name} {operator} ${}", binds.len()))
}

fn text_predicate(
    name: &str,
    column: ColumnDef,
    filter: &FilterItem,
    binds: &mut Vec<BindValue>,
) -> Result<String, AppError> {
    // A uuid column still has to answer the "Filter invoice..." text box, where
    // staff type the first few characters of an id, so it is compared as text
    // for the substring operators and as a uuid everywhere else.
    let as_text = if column.kind == ColumnKind::Uuid {
        format!("{name}::text")
    } else {
        name.to_string()
    };

    match filter.operator {
        FilterOperator::ILike => {
            binds.push(BindValue::Text(filter.value.as_one()?.to_string()));
            Ok(format!("{as_text} ILIKE '%' || ${} || '%'", binds.len()))
        }
        FilterOperator::NotILike => {
            binds.push(BindValue::Text(filter.value.as_one()?.to_string()));
            Ok(format!(
                "({as_text} IS NULL OR {as_text} NOT ILIKE '%' || ${} || '%')",
                binds.len()
            ))
        }
        FilterOperator::Eq => {
            binds.push(text_bind(column, filter.value.as_one()?)?);
            Ok(format!("{name} = ${}", binds.len()))
        }
        FilterOperator::Ne => {
            binds.push(text_bind(column, filter.value.as_one()?)?);
            Ok(format!("{name} IS DISTINCT FROM ${}", binds.len()))
        }
        FilterOperator::InArray => {
            binds.push(text_list_bind(column, &filter.value)?);
            Ok(format!("{name} = ANY(${})", binds.len()))
        }
        FilterOperator::NotInArray => {
            binds.push(text_list_bind(column, &filter.value)?);
            Ok(format!("NOT ({name} = ANY(${}))", binds.len()))
        }
        other => Err(unsupported(other, column.kind)),
    }
}

fn scalar_predicate(
    name: &str,
    column: ColumnDef,
    filter: &FilterItem,
    binds: &mut Vec<BindValue>,
) -> Result<String, AppError> {
    let comparison = match filter.operator {
        FilterOperator::Eq => Some("="),
        FilterOperator::Lt => Some("<"),
        FilterOperator::Lte => Some("<="),
        FilterOperator::Gt => Some(">"),
        FilterOperator::Gte => Some(">="),
        FilterOperator::Ne | FilterOperator::IsBetween => None,
        other => return Err(unsupported(other, column.kind)),
    };

    if let Some(comparison) = comparison {
        binds.push(scalar_bind(column, filter.value.as_one()?)?);
        return Ok(format!("{name} {comparison} ${}", binds.len()));
    }

    if filter.operator == FilterOperator::Ne {
        binds.push(scalar_bind(column, filter.value.as_one()?)?);
        return Ok(format!("{name} IS DISTINCT FROM ${}", binds.len()));
    }

    // `isBetween` is the only two-value operator, and either bound may be blank
    // — the slider and date-range controls both emit half-open ranges.
    let (lower, upper) = filter.value.as_pair()?;
    let mut parts = Vec::new();

    if let Some(lower) = lower {
        binds.push(scalar_bind(column, lower)?);
        parts.push(format!("{name} >= ${}", binds.len()));
    }
    if let Some(upper) = upper {
        binds.push(scalar_bind(column, upper)?);
        parts.push(format!("{name} <= ${}", binds.len()));
    }

    if parts.is_empty() {
        // Both sides blank: the filter says nothing, so it must not remove rows.
        return Ok("TRUE".to_string());
    }

    Ok(format!("({})", parts.join(" AND ")))
}

fn text_bind(column: ColumnDef, raw: &str) -> Result<BindValue, AppError> {
    match column.kind {
        ColumnKind::Uuid => Ok(BindValue::Uuid(parse_uuid(raw)?)),
        _ => Ok(BindValue::Text(raw.to_string())),
    }
}

fn text_list_bind(column: ColumnDef, value: &FilterValue) -> Result<BindValue, AppError> {
    match column.kind {
        ColumnKind::Uuid => Ok(BindValue::UuidList(
            value
                .as_many()
                .iter()
                .map(|raw| parse_uuid(raw))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        _ => Ok(BindValue::TextList(value.as_many())),
    }
}

fn scalar_bind(column: ColumnDef, raw: &str) -> Result<BindValue, AppError> {
    match column.kind {
        ColumnKind::Number => raw
            .trim()
            .parse::<f64>()
            .map(BindValue::Number)
            .map_err(|_| AppError::BadRequest(format!("`{raw}` is not a number"))),
        ColumnKind::Date => parse_date(raw).map(BindValue::Date),
        _ => Ok(BindValue::Text(raw.to_string())),
    }
}

fn parse_uuid(raw: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw.trim()).map_err(|_| AppError::BadRequest(format!("`{raw}` is not an id")))
}

/// Dates arrive in two spellings: the date-picker controls emit epoch
/// milliseconds, while a hand-written or shared URL carries `YYYY-MM-DD`. Both
/// are accepted, and epoch values are read in UTC.
fn parse_date(raw: &str) -> Result<NaiveDate, AppError> {
    let raw = raw.trim();

    if !raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return raw
            .parse::<i64>()
            .ok()
            .and_then(DateTime::from_timestamp_millis)
            .map(|timestamp| timestamp.date_naive())
            .ok_or_else(|| AppError::BadRequest(format!("`{raw}` is not a date")));
    }

    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest(format!("`{raw}` is not a date")))
}

fn unsupported(operator: FilterOperator, kind: ColumnKind) -> AppError {
    AppError::BadRequest(format!(
        "operator {operator:?} cannot be used on a {kind:?} column"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::list::params::{parse, RawListParams};
    use serde_json::json;

    const SPEC: ListSpec = ListSpec {
        base_sql: "SELECT id, name, total, due_on, active, tags FROM widgets",
        columns: &[
            ("id", ColumnDef::new("id", ColumnKind::Uuid)),
            ("name", ColumnDef::new("name", ColumnKind::Text)),
            ("total", ColumnDef::new("total", ColumnKind::Number)),
            ("dueOn", ColumnDef::new("due_on", ColumnKind::Date)),
            ("active", ColumnDef::new("active", ColumnKind::Bool)),
            ("tags", ColumnDef::new("tags", ColumnKind::TextArray)),
        ],
        default_order: "id DESC",
    };

    fn params(value: serde_json::Value) -> ListParams {
        let raw: RawListParams = serde_json::from_value(value).unwrap();
        parse(raw).unwrap()
    }

    fn filtered(filters: serde_json::Value) -> Result<BuiltQuery, AppError> {
        build(&SPEC, &params(json!({ "filters": filters.to_string() })))
    }

    #[test]
    fn an_empty_request_wraps_the_base_query_and_orders_by_the_tie_breaker() {
        let built = build(&SPEC, &params(json!({}))).unwrap();

        assert!(built.sql.starts_with("WITH base AS ("), "{}", built.sql);
        assert!(built.sql.contains("count(*) OVER () AS list_total"));
        assert!(!built.sql.contains("WHERE"));
        assert!(built.sql.trim_end().ends_with("ORDER BY id DESC"));
        assert!(built.binds.is_empty());
    }

    #[test]
    fn paging_binds_limit_and_offset_last() {
        let built = build(&SPEC, &params(json!({ "page": 3, "perPage": 10 }))).unwrap();

        assert!(built.sql.trim_end().ends_with("LIMIT $1 OFFSET $2"));
        assert_eq!(built.binds, vec![BindValue::Int(10), BindValue::Int(20)]);
    }

    #[test]
    fn filter_binds_are_numbered_before_the_paging_binds() {
        let built = build(
            &SPEC,
            &params(json!({
                "page": 2,
                "perPage": 5,
                "filters": json!([
                    { "id": "name", "value": "ali", "variant": "text", "operator": "iLike" }
                ])
                .to_string(),
            })),
        )
        .unwrap();

        assert!(
            built.sql.contains("ILIKE '%' || $1 || '%'"),
            "{}",
            built.sql
        );
        assert!(built.sql.trim_end().ends_with("LIMIT $2 OFFSET $3"));
        assert_eq!(
            built.binds,
            vec![
                BindValue::Text("ali".to_string()),
                BindValue::Int(5),
                BindValue::Int(5),
            ]
        );
    }

    #[test]
    fn a_sort_precedes_the_default_order() {
        let built = build(
            &SPEC,
            &params(json!({
                "sort": json!([{ "id": "name", "desc": true }]).to_string(),
            })),
        )
        .unwrap();

        assert!(
            built.sql.contains("ORDER BY base.\"name\" DESC, id DESC"),
            "{}",
            built.sql
        );
    }

    #[test]
    fn several_sorts_are_applied_in_order() {
        let built = build(
            &SPEC,
            &params(json!({
                "sort": json!([
                    { "id": "total", "desc": false },
                    { "id": "name", "desc": true },
                ])
                .to_string(),
            })),
        )
        .unwrap();

        assert!(
            built
                .sql
                .contains("ORDER BY base.\"total\" ASC, base.\"name\" DESC, id DESC"),
            "{}",
            built.sql
        );
    }

    #[test]
    fn several_filters_join_with_and_by_default_and_or_on_request() {
        let two = json!([
            { "id": "name", "value": "ali", "variant": "text", "operator": "iLike" },
            { "id": "total", "value": "10", "variant": "number", "operator": "gt" },
        ]);

        let and = filtered(two.clone()).unwrap();
        assert!(
            and.sql.contains("$1 || '%' AND base.\"total\" > $2"),
            "{}",
            and.sql
        );

        let or = build(
            &SPEC,
            &params(json!({ "filters": two.to_string(), "joinOperator": "or" })),
        )
        .unwrap();
        assert!(
            or.sql.contains("$1 || '%' OR base.\"total\" > $2"),
            "{}",
            or.sql
        );
    }

    #[test]
    fn text_operators_render_the_expected_sql() {
        let cases = [
            ("iLike", "base.\"name\" ILIKE '%' || $1 || '%'"),
            (
                "notILike",
                "(base.\"name\" IS NULL OR base.\"name\" NOT ILIKE '%' || $1 || '%')",
            ),
            ("eq", "base.\"name\" = $1"),
            ("ne", "base.\"name\" IS DISTINCT FROM $1"),
        ];

        for (operator, expected) in cases {
            let built = filtered(json!([
                { "id": "name", "value": "ali", "variant": "text", "operator": operator }
            ]))
            .unwrap();

            assert!(built.sql.contains(expected), "{operator}: {}", built.sql);
            assert_eq!(built.binds, vec![BindValue::Text("ali".to_string())]);
        }
    }

    #[test]
    fn a_multi_select_on_a_text_column_binds_a_list() {
        let built = filtered(json!([
            {
                "id": "name",
                "value": ["paid", "partial"],
                "variant": "multiSelect",
                "operator": "inArray",
            }
        ]))
        .unwrap();

        assert!(
            built.sql.contains("base.\"name\" = ANY($1)"),
            "{}",
            built.sql
        );
        assert_eq!(
            built.binds,
            vec![BindValue::TextList(vec![
                "paid".to_string(),
                "partial".to_string()
            ])]
        );
    }

    #[test]
    fn an_array_column_is_matched_by_overlap() {
        let built = filtered(json!([
            {
                "id": "tags",
                "value": ["cotton", "linen"],
                "variant": "multiSelect",
                "operator": "inArray",
            }
        ]))
        .unwrap();

        assert!(
            built.sql.contains("base.\"tags\" && $1::text[]"),
            "{}",
            built.sql
        );

        let excluded = filtered(json!([
            { "id": "tags", "value": ["cotton"], "variant": "multiSelect", "operator": "notInArray" }
        ]))
        .unwrap();

        assert!(
            excluded.sql.contains("NOT (base.\"tags\" && $1::text[])"),
            "{}",
            excluded.sql
        );
    }

    #[test]
    fn a_text_search_on_an_array_column_matches_any_element() {
        let built = filtered(json!([
            { "id": "tags", "value": "cot", "variant": "text", "operator": "iLike" }
        ]))
        .unwrap();

        assert!(
            built
                .sql
                .contains("EXISTS (SELECT 1 FROM unnest(base.\"tags\") AS element"),
            "{}",
            built.sql
        );
    }

    #[test]
    fn a_uuid_column_is_compared_as_text_for_substring_search() {
        let built = filtered(json!([
            { "id": "id", "value": "0193", "variant": "text", "operator": "iLike" }
        ]))
        .unwrap();

        assert!(
            built
                .sql
                .contains("base.\"id\"::text ILIKE '%' || $1 || '%'"),
            "{}",
            built.sql
        );
        assert_eq!(built.binds, vec![BindValue::Text("0193".to_string())]);
    }

    #[test]
    fn a_uuid_column_binds_a_uuid_for_exact_comparison() {
        let id = "0192f7a0-0000-7000-8000-000000000000";
        let built = filtered(json!([
            { "id": "id", "value": id, "variant": "text", "operator": "eq" }
        ]))
        .unwrap();

        assert_eq!(
            built.binds,
            vec![BindValue::Uuid(Uuid::parse_str(id).unwrap())]
        );
    }

    #[test]
    fn a_range_filter_binds_both_bounds() {
        let built = filtered(json!([
            {
                "id": "total",
                "value": ["10", "500"],
                "variant": "range",
                "operator": "isBetween",
            }
        ]))
        .unwrap();

        assert!(
            built
                .sql
                .contains("(base.\"total\" >= $1 AND base.\"total\" <= $2)"),
            "{}",
            built.sql
        );
        assert_eq!(
            built.binds,
            vec![BindValue::Number(10.0), BindValue::Number(500.0)]
        );
    }

    #[test]
    fn a_half_open_range_binds_only_the_side_it_has() {
        let built = filtered(json!([
            { "id": "total", "value": ["10", ""], "variant": "range", "operator": "isBetween" }
        ]))
        .unwrap();

        assert!(
            built.sql.contains("(base.\"total\" >= $1)"),
            "{}",
            built.sql
        );
        assert_eq!(built.binds, vec![BindValue::Number(10.0)]);
    }

    #[test]
    fn a_range_with_no_bounds_at_all_removes_no_rows() {
        let built = filtered(json!([
            { "id": "total", "value": ["", ""], "variant": "range", "operator": "isBetween" }
        ]))
        .unwrap();

        assert!(built.sql.contains("WHERE TRUE"), "{}", built.sql);
        assert!(built.binds.is_empty());
    }

    #[test]
    fn dates_are_accepted_as_iso_text_or_epoch_milliseconds() {
        let iso = filtered(json!([
            { "id": "dueOn", "value": "2026-07-30", "variant": "date", "operator": "eq" }
        ]))
        .unwrap();

        let epoch = filtered(json!([
            { "id": "dueOn", "value": "1785369600000", "variant": "date", "operator": "eq" }
        ]))
        .unwrap();

        let expected = BindValue::Date(NaiveDate::from_ymd_opt(2026, 7, 30).unwrap());
        assert_eq!(iso.binds, vec![expected.clone()]);
        assert_eq!(epoch.binds, vec![expected]);
    }

    #[test]
    fn booleans_accept_the_spellings_a_url_can_carry() {
        for raw in ["true", "1"] {
            let built = filtered(json!([
                { "id": "active", "value": raw, "variant": "boolean", "operator": "eq" }
            ]))
            .unwrap();

            assert_eq!(built.binds, vec![BindValue::Bool(true)], "{raw}");
        }

        for raw in ["false", "0"] {
            let built = filtered(json!([
                { "id": "active", "value": raw, "variant": "boolean", "operator": "eq" }
            ]))
            .unwrap();

            assert_eq!(built.binds, vec![BindValue::Bool(false)], "{raw}");
        }
    }

    #[test]
    fn emptiness_checks_bind_nothing_and_know_the_column_shape() {
        let text = filtered(json!([
            { "id": "name", "value": "", "variant": "text", "operator": "isEmpty" }
        ]))
        .unwrap();
        assert!(
            text.sql
                .contains("(base.\"name\" IS NULL OR base.\"name\" = '')"),
            "{}",
            text.sql
        );
        assert!(text.binds.is_empty());

        let tags = filtered(json!([
            { "id": "tags", "value": "", "variant": "multiSelect", "operator": "isNotEmpty" }
        ]))
        .unwrap();
        assert!(
            tags.sql.contains("cardinality(base.\"tags\")"),
            "{}",
            tags.sql
        );
        assert!(tags.sql.contains("NOT ("), "{}", tags.sql);

        let total = filtered(json!([
            { "id": "total", "value": "", "variant": "number", "operator": "isEmpty" }
        ]))
        .unwrap();
        assert!(
            total.sql.contains("base.\"total\" IS NULL"),
            "{}",
            total.sql
        );
    }

    #[test]
    fn an_unknown_column_is_rejected_whether_sorted_or_filtered() {
        let sorted = build(
            &SPEC,
            &params(json!({ "sort": json!([{ "id": "nope", "desc": false }]).to_string() })),
        )
        .unwrap_err();
        assert!(matches!(sorted, AppError::BadRequest(_)));

        let filter = filtered(json!([
            { "id": "nope", "value": "x", "variant": "text", "operator": "eq" }
        ]))
        .unwrap_err();
        assert!(matches!(filter, AppError::BadRequest(_)));
    }

    #[test]
    fn an_operator_the_column_cannot_answer_is_rejected() {
        let cases = [
            ("active", "isBetween", "boolean"),
            ("tags", "gt", "multiSelect"),
            ("total", "iLike", "number"),
            ("name", "lt", "text"),
        ];

        for (id, operator, variant) in cases {
            let error = filtered(json!([
                { "id": id, "value": "1", "variant": variant, "operator": operator }
            ]))
            .unwrap_err();

            assert!(
                matches!(error, AppError::BadRequest(_)),
                "{id} {operator}: {error:?}"
            );
        }
    }

    #[test]
    fn is_relative_to_today_is_rejected_rather_than_silently_ignored() {
        let error = filtered(json!([
            { "id": "dueOn", "value": "today", "variant": "date", "operator": "isRelativeToToday" }
        ]))
        .unwrap_err();

        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn unparseable_values_are_rejected_before_reaching_the_database() {
        let cases = [
            ("total", "number", "eq", "not-a-number"),
            ("dueOn", "date", "eq", "not-a-date"),
            ("active", "boolean", "eq", "maybe"),
            ("id", "text", "eq", "not-an-id"),
        ];

        for (id, variant, operator, value) in cases {
            let error = filtered(json!([
                { "id": id, "value": value, "variant": variant, "operator": operator }
            ]))
            .unwrap_err();

            assert!(matches!(error, AppError::BadRequest(_)), "{id}={value:?}");
        }
    }

    #[test]
    fn a_lookup_by_id_binds_the_id_alone() {
        let id = Uuid::parse_str("0192f7a0-0000-7000-8000-000000000000").unwrap();
        let built = build_by_id(&SPEC, id).unwrap();

        assert!(
            built.sql.contains("WHERE base.\"id\" = $1 LIMIT 1"),
            "{}",
            built.sql
        );
        assert_eq!(built.binds, vec![BindValue::Uuid(id)]);
    }
}
