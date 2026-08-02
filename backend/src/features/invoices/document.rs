//! Renders an invoice as a self-contained HTML document.
//!
//! The output is deliberately a complete HTML page rather than a PDF. Arabic
//! needs a real text shaper, which the pure-Rust PDF crates don't have, and
//! the browser already is one — so the document is printed to PDF by whatever
//! renders it. Today that is the user's browser, through an iframe; the same
//! HTML can later be handed to a headless browser to produce PDFs with nobody
//! watching, which is why none of this lives in the frontend.
//!
//! Nothing in the page is fetched at render time: styles are inline, the QR
//! code is an inline SVG, and the logo is a `data:` URI.

use base64::Engine;
use minijinja::{context, Environment};

use crate::{config::InvoiceBranding, error::AppError, state::AppState};

use super::{
    service,
    types::{InvoiceDetail, InvoiceParty},
};

/// The copy of the template compiled into the binary, used unless
/// `INVOICE_TEMPLATE_DIR` points somewhere else.
const DEFAULT_TEMPLATE: &str = include_str!("../../../templates/invoice.html");

const TEMPLATE_NAME: &str = "invoice.html";

/// Currency of the printed amounts. Single-valued by design, matching
/// `CURRENCY` in the frontend's `src/lib/currency.ts`.
const CURRENCY: &str = "BHD";

/// Fils, not cents: BHD is a three-decimal currency. Amounts are still stored
/// and computed to two places (`NUMERIC(10, 2)`), so this only affects how
/// they are written out.
const CURRENCY_DECIMALS: usize = 3;

fn environment(branding: &InvoiceBranding) -> Result<Environment<'static>, AppError> {
    let mut env = Environment::new();

    match &branding.template_dir {
        // Loading from disk means the document can be restyled and the change
        // seen on the next request, with no rebuild and no redeploy.
        Some(dir) => env.set_loader(minijinja::path_loader(dir)),
        None => env.add_template(TEMPLATE_NAME, DEFAULT_TEMPLATE)?,
    }

    Ok(env)
}

/// Encodes one TLV field: a tag byte, a length byte, then the value's UTF-8
/// bytes. The length is a byte count, which is the thing to be careful about —
/// an Arabic seller name is two bytes per character, so counting characters
/// produces a QR code that scanners reject.
fn tlv_field(tag: u8, value: &str, out: &mut Vec<u8>) {
    let bytes = value.as_bytes();
    // A single length byte caps a field at 255 bytes. Truncating on a
    // character boundary keeps the value valid UTF-8; the alternative is
    // emitting a field whose declared length can't be represented.
    let bytes = if bytes.len() > u8::MAX as usize {
        let mut end = u8::MAX as usize;
        while end > 0 && !value.is_char_boundary(end) {
            end -= 1;
        }
        &value.as_bytes()[..end]
    } else {
        bytes
    };

    out.push(tag);
    out.push(bytes.len() as u8);
    out.extend_from_slice(bytes);
}

/// The base64 TLV payload carried by the QR code on the document: seller name,
/// seller VAT number, timestamp, total including VAT, and the VAT itself.
///
/// This is the tag layout GCC tax authorities have standardised on for the QR
/// on a simplified tax invoice. It has not been validated against any one
/// authority's certification suite — see the note in CLAUDE.md.
fn qr_payload(detail: &InvoiceDetail, branding: &InvoiceBranding) -> String {
    let mut tlv = Vec::new();
    tlv_field(1, &branding.name_ar, &mut tlv);
    tlv_field(2, &branding.vat_number, &mut tlv);
    tlv_field(3, &detail.created_at.to_rfc3339(), &mut tlv);
    tlv_field(4, &format_amount(detail.totals.total), &mut tlv);
    tlv_field(5, &format_amount(detail.totals.vat), &mut tlv);

    base64::engine::general_purpose::STANDARD.encode(tlv)
}

fn format_amount(value: f64) -> String {
    format!("{value:.CURRENCY_DECIMALS$}")
}

/// Quantities are not money: 3 metres is "3", not "3.000", but 3.25 metres
/// still has to keep its fraction. Trailing zeros are trimmed rather than a
/// fixed precision applied.
fn format_quantity(value: f64) -> String {
    let text = format!("{value:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

/// Renders the payload as an inline SVG, so the page needs no image request
/// and no JavaScript to display it.
fn qr_svg(payload: &str) -> Result<String, AppError> {
    let code = qrcode::QrCode::new(payload.as_bytes()).map_err(|error| {
        AppError::Template(format!("could not build the invoice QR code: {error}"))
    })?;

    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(120, 120)
        .quiet_zone(true)
        .build())
}

pub async fn render_invoice_document(
    state: &AppState,
    invoice_id: uuid::Uuid,
) -> Result<String, AppError> {
    let detail = service::get_invoice(state, invoice_id).await?;
    let branding = state.invoice_branding();

    let env = environment(branding)?;
    let template = env.get_template(TEMPLATE_NAME)?;

    let payload = qr_payload(&detail, branding);

    Ok(template.render(context! {
        invoice => minijinja::Value::from_serialize(&detail),
        // Deduplicated here rather than in the template: an invoice can carry
        // orders for several people, each line naming its own, and the header
        // wants each of them once.
        customers => minijinja::Value::from_serialize(billed_customers(&detail)),
        company => minijinja::Value::from_serialize(branding),
        currency => CURRENCY,
        // Amounts are pre-formatted rather than left to the template, so that
        // editing the design can't accidentally change how money is written.
        amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
        qr_svg => qr_svg(&payload)?,
        // The VAT rate is printed as a percentage, e.g. "10".
        vat_percent => format!("{}", (detail.totals.vat_rate * 100.0).round()),
    })?)
}

/// Everyone the invoice is for: the named buyer if there is one, otherwise the
/// customers its tailoring lines were measured for, each listed once and in
/// the order their first line appears.
fn billed_customers(detail: &InvoiceDetail) -> Vec<&InvoiceParty> {
    if let Some(buyer) = &detail.buyer {
        return vec![buyer];
    }

    let mut seen = std::collections::HashSet::new();
    detail
        .lines
        .iter()
        .filter_map(|line| line.customer.as_ref())
        .filter(|customer| seen.insert(customer.mobile_no.as_str()))
        .collect()
}

/// Every amount on the document, written out once. Keyed by the name the
/// template refers to it by.
fn formatted_amounts(detail: &InvoiceDetail) -> std::collections::BTreeMap<String, String> {
    let totals = &detail.totals;
    let mut amounts = std::collections::BTreeMap::new();

    for (key, value) in [
        ("subtotal", totals.subtotal),
        ("discountAmount", totals.discount_amount),
        ("taxable", totals.taxable),
        ("vat", totals.vat),
        ("giftCardSales", totals.gift_card_sales),
        ("total", totals.total),
        ("giftCardRedeemed", totals.gift_card_redeemed),
        ("amountPaid", totals.amount_paid),
        ("balanceDue", totals.balance_due),
    ] {
        amounts.insert(key.to_string(), format_amount(value));
    }

    amounts.insert(
        "discountPercent".to_string(),
        format_quantity(totals.discount),
    );

    for (index, line) in detail.lines.iter().enumerate() {
        amounts.insert(
            format!("line{index}UnitPrice"),
            format_amount(line.unit_price),
        );
        amounts.insert(format!("line{index}Total"), format_amount(line.line_total));
        amounts.insert(
            format!("line{index}Quantity"),
            format_quantity(line.quantity),
        );
    }

    for (index, redemption) in detail.redemptions.iter().enumerate() {
        amounts.insert(
            format!("redemption{index}"),
            format_amount(redemption.amount),
        );
    }

    amounts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn branding() -> InvoiceBranding {
        InvoiceBranding {
            name_en: "Fabric Sync".to_string(),
            name_ar: "متجر".to_string(),
            vat_number: "200000000000002".to_string(),
            cr_number: "12345".to_string(),
            address_en: String::new(),
            address_ar: String::new(),
            phone: String::new(),
            email: String::new(),
            logo_data_url: None,
            template_dir: None,
        }
    }

    #[test]
    fn a_tlv_field_is_tag_length_then_value() {
        let mut out = Vec::new();
        tlv_field(1, "AB", &mut out);
        assert_eq!(out, vec![1, 2, b'A', b'B']);
    }

    #[test]
    fn a_tlv_length_counts_bytes_not_characters() {
        let mut out = Vec::new();
        // Four Arabic characters, two bytes each.
        tlv_field(1, "متجر", &mut out);
        assert_eq!(out[0], 1);
        assert_eq!(out[1], 8);
        assert_eq!(out.len(), 10);
    }

    #[test]
    fn an_overlong_value_is_truncated_on_a_character_boundary() {
        let mut out = Vec::new();
        // 200 two-byte characters is 400 bytes, well over what one length
        // byte can describe.
        let long = "م".repeat(200);
        tlv_field(1, &long, &mut out);

        let length = out[1] as usize;
        assert_eq!(out.len(), length + 2);
        assert!(std::str::from_utf8(&out[2..]).is_ok());
    }

    #[test]
    fn the_default_template_compiles() {
        let env = environment(&branding()).unwrap();
        assert!(env.get_template(TEMPLATE_NAME).is_ok());
    }

    #[test]
    fn amounts_are_written_to_three_decimal_places() {
        assert_eq!(format_amount(12.5), "12.500");
    }

    #[test]
    fn the_qr_payload_is_decodable_base64_carrying_the_five_fields() {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(qr_payload(&super::tests_support::detail(), &branding()))
            .unwrap();

        // Walk the TLV structure and collect the tags in order.
        let mut tags = Vec::new();
        let mut cursor = 0;
        while cursor < decoded.len() {
            tags.push(decoded[cursor]);
            let length = decoded[cursor + 1] as usize;
            cursor += 2 + length;
        }

        assert_eq!(tags, vec![1, 2, 3, 4, 5]);
        assert_eq!(cursor, decoded.len());
    }
}

#[cfg(test)]
mod tests_support {
    use chrono::{NaiveDate, TimeZone, Utc};

    use super::super::types::{InvoiceDetail, InvoiceTotalsBreakdown};

    pub fn detail() -> InvoiceDetail {
        InvoiceDetail {
            id: uuid::Uuid::nil(),
            invoice_number: 1,
            date: NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
            created_at: Utc.with_ymd_and_hms(2026, 7, 30, 9, 30, 0).unwrap(),
            branch_name: None,
            buyer: None,
            payment_status: "paid".to_string(),
            advance_amount: 0.0,
            advance_payment_type: None,
            final_payment_type: None,
            lines: Vec::new(),
            redemptions: Vec::new(),
            totals: InvoiceTotalsBreakdown {
                subtotal: 100.0,
                discount: 0.0,
                discount_unit: "amount".to_string(),
                discount_amount: 0.0,
                taxable: 100.0,
                vat_rate: 0.1,
                vat: 10.0,
                gift_card_sales: 0.0,
                total: 110.0,
                gift_card_redeemed: 0.0,
                amount_paid: 110.0,
                balance_due: 0.0,
            },
        }
    }
}
