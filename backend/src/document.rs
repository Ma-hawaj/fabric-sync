//! Shared bits between the feature document renderers (invoices, orders):
//! the money/quantity formatting and the minijinja environment setup. One
//! copy of each so the printed figures can't drift between documents.

use minijinja::Environment;

use crate::{config::InvoiceBranding, error::AppError};

/// Currency of the printed amounts. Single-valued by design, matching
/// `CURRENCY` in the frontend's `src/lib/currency.ts`.
pub(crate) const CURRENCY: &str = "BHD";

/// Fils, not cents: BHD is a three-decimal currency. Amounts are still stored
/// and computed to two places (`NUMERIC(10, 2)`), so this only affects how
/// they are written out.
pub(crate) const CURRENCY_DECIMALS: usize = 3;

pub(crate) fn format_amount(value: f64) -> String {
    format!("{value:.CURRENCY_DECIMALS$}")
}

/// Quantities are not money: 3 metres is "3", not "3.000", but 3.25 metres
/// still has to keep its fraction. Trailing zeros are trimmed rather than a
/// fixed precision applied.
pub(crate) fn format_quantity(value: f64) -> String {
    let text = format!("{value:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

/// A timestamp as the printed documents write it: the calendar date in the
/// shop's timezone plus the time of day, day-first, e.g. "30-07-2026 12:30
/// +03". Pre-formatted like the amounts, so editing a template can't change
/// how a moment is written — serializing the raw timestamp would print UTC
/// RFC 3339 into the page.
pub(crate) fn format_datetime(
    value: &chrono::DateTime<chrono::Utc>,
    timezone: chrono_tz::Tz,
) -> String {
    value
        .with_timezone(&timezone)
        .format("%d-%m-%Y %H:%M %Z")
        .to_string()
}

/// A bare calendar date as the printed documents write it, day-first:
/// "30-07-2026". Dates carry no zone, so there is nothing to convert — this
/// only fixes the field order off the year-first ISO the raw value
/// serializes as.
pub(crate) fn format_date(value: &chrono::NaiveDate) -> String {
    value.format("%d-%m-%Y").to_string()
}

/// A minijinja environment that loads the named template from
/// `INVOICE_TEMPLATE_DIR` when it is set, else the copy embedded in the
/// binary. Both the invoice and the order document live in the same templates
/// directory, so the one env var serves both.
pub(crate) fn template_environment(
    branding: &InvoiceBranding,
    template_name: &'static str,
    embedded: &'static str,
) -> Result<Environment<'static>, AppError> {
    let mut env = Environment::new();

    match &branding.template_dir {
        // Loading from disk means the document can be restyled and the change
        // seen on the next request, with no rebuild and no redeploy.
        Some(dir) => env.set_loader(minijinja::path_loader(dir)),
        None => env.add_template(template_name, embedded)?,
    }

    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn datetimes_print_day_first_in_the_shop_timezone() {
        let moment = chrono::Utc.with_ymd_and_hms(2026, 7, 30, 9, 30, 0).unwrap();
        // 09:30 UTC is 12:30 in Bahrain (+03, no daylight saving).
        assert_eq!(
            format_datetime(&moment, chrono_tz::Asia::Bahrain),
            "30-07-2026 12:30 +03"
        );
    }

    #[test]
    fn datetimes_follow_whichever_zone_is_configured() {
        let moment = chrono::Utc.with_ymd_and_hms(2026, 7, 30, 9, 30, 0).unwrap();
        assert_eq!(
            format_datetime(&moment, chrono_tz::UTC),
            "30-07-2026 09:30 UTC"
        );
    }

    #[test]
    fn dates_print_day_first() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 7, 30).unwrap();
        assert_eq!(format_date(&date), "30-07-2026");
    }

    #[test]
    fn an_unknown_timezone_name_is_rejected() {
        assert!("Mars/Olympus".parse::<chrono_tz::Tz>().is_err());
        assert!("Asia/Bahrain".parse::<chrono_tz::Tz>().is_ok());
    }
}
