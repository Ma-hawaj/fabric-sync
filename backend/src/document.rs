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
