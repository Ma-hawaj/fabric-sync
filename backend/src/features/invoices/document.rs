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
use serde::Serialize;

use crate::{
    config::InvoiceBranding,
    document::{format_amount, format_quantity, CURRENCY},
    error::AppError,
    state::AppState,
};

use super::{
    designs, service,
    types::{InvoiceDetail, InvoiceParty, OrderDesignValues},
};

/// The copy of the template compiled into the binary, used unless
/// `INVOICE_TEMPLATE_DIR` points somewhere else.
const DEFAULT_TEMPLATE: &str = include_str!("../../../templates/invoice.html");

const TEMPLATE_NAME: &str = "invoice.html";

/// The order design slots, in the order they render on the document. The value
/// in each column is looked up against the catalog; a stored value that
/// matches nothing (older orders predate the catalog) prints as a text-only
/// chip rather than disappearing.
const SLOT_TITLES: [(&str, &str); 5] = [
    ("النوع", "Thobe"),
    ("الياقة", "Collar"),
    ("الكم", "Sleeve"),
    ("الجيب", "Pocket"),
    ("الباتي", "Patti"),
];

/// One chip: a title, the resolved label and, when a catalog asset exists, a
/// self-contained `data:` URI for its image.
#[derive(Serialize)]
struct DesignChip<'a> {
    title_ar: &'a str,
    title_en: &'a str,
    label: String,
    image: Option<String>,
}

/// The catalog assets live in a generated module whose paths are rows; the
/// lookup is small enough to keep here next to the renderer.
fn design_asset(section: &str, slug: &str) -> Option<&'static designs::DesignAsset> {
    designs::DESIGNS
        .iter()
        .find(|asset| asset.section == section && asset.slug == slug)
}

/// A stored design value, trimmed. Matching is exact against the catalog id;
/// anything else stays text.
fn design_value(values: &OrderDesignValues, slot: usize) -> Option<&str> {
    let value = match slot {
        0 => values.thobe_type.as_deref(),
        1 => values.collar.as_deref(),
        2 => values.sleeve.as_deref(),
        3 => values.f_pocket.as_deref(),
        4 => values.patti.as_deref(),
        _ => return None,
    };
    let value = value?.trim();
    (!value.is_empty()).then_some(value)
}

/// The chips for one line, in fixed slot order, so a thobe always prints its
/// type first regardless of which fields were filled in.
fn line_designs(values: Option<&OrderDesignValues>) -> Vec<DesignChip<'static>> {
    let Some(values) = values else {
        return Vec::new();
    };

    SLOT_TITLES
        .iter()
        .enumerate()
        .filter_map(|(slot, (title_ar, title_en))| {
            let raw = design_value(values, slot)?;
            let (label, image) = match design_asset(SLOT_SECTIONS[slot], raw) {
                Some(asset) => (asset.label.to_string(), Some(data_uri(asset.bytes))),
                None => (raw.to_string(), None),
            };
            Some(DesignChip {
                title_ar,
                title_en,
                label,
                image,
            })
        })
        .collect()
}

/// Which catalog section a slot's values are drawn from.
const SLOT_SECTIONS: [&str; 5] = ["thob_type", "neck", "sleeve", "front_pocket", "patti"];

fn data_uri(bytes: &[u8]) -> String {
    format!(
        "data:image/webp;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn environment(branding: &InvoiceBranding) -> Result<Environment<'static>, AppError> {
    crate::document::template_environment(branding, TEMPLATE_NAME, DEFAULT_TEMPLATE)
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

    // Design chips and line notes, aligned to detail.lines. Kept out of the
    // serialized invoice (see the `design_values` skip) and passed alongside
    // it because the template is the only consumer.
    let line_designs: Vec<Vec<DesignChip>> = detail
        .lines
        .iter()
        .map(|line| line_designs(line.design_values.as_ref()))
        .collect();
    let line_notes: Vec<Option<String>> = detail
        .lines
        .iter()
        .map(|line| {
            line.design_values
                .as_ref()
                .and_then(|values| values.more_details.as_deref())
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(str::to_string)
        })
        .collect();

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
        // Design chips and free-text notes per line, in the same order as
        // invoice.lines (see the doc comment at the top of the template).
        line_designs => minijinja::Value::from_serialize(&line_designs),
        line_notes => minijinja::Value::from_serialize(&line_notes),
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
    use crate::features::invoices::types::OrderDesignValues;

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

    fn values(
        thobe_type: Option<&str>,
        collar: Option<&str>,
        sleeve: Option<&str>,
        f_pocket: Option<&str>,
        patti: Option<&str>,
    ) -> OrderDesignValues {
        OrderDesignValues {
            thobe_type: thobe_type.map(str::to_string),
            collar: collar.map(str::to_string),
            sleeve: sleeve.map(str::to_string),
            f_pocket: f_pocket.map(str::to_string),
            patti: patti.map(str::to_string),
            more_details: None,
        }
    }

    #[test]
    fn chips_follow_the_fixed_slot_order() {
        let chips = line_designs(Some(&values(
            Some("thobx"),
            Some("3"),
            Some("open"),
            Some("round"),
            Some("normal"),
        )));
        assert_eq!(
            chips.iter().map(|c| c.title_en).collect::<Vec<_>>(),
            vec!["Thobe", "Collar", "Sleeve", "Pocket", "Patti"]
        );
        assert_eq!(
            chips.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(),
            vec!["Thobx", "3", "Open", "Round", "Normal"]
        );
    }

    #[test]
    fn a_catalog_design_carries_a_webp_data_uri() {
        let chips = line_designs(Some(&values(Some("thobx"), None, None, None, None)));
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].label, "Thobx");
        let image = chips[0].image.as_deref().unwrap();
        assert!(image.starts_with("data:image/webp;base64,"));
        assert!(!image.split_once(',').unwrap().1.is_empty());
    }

    #[test]
    fn an_uncatalogued_value_prints_as_a_text_only_chip() {
        // The dev seed predates the catalog and stores human values like
        // "Saudi"; those still have to survive onto the document.
        let chips = line_designs(Some(&values(
            Some("Saudi"),
            Some("Round"),
            Some("Cuff"),
            None,
            None,
        )));
        assert_eq!(chips.len(), 3);
        for chip in &chips {
            assert!(chip.image.is_none());
        }
        assert_eq!(chips[2].label, "Cuff");
    }

    #[test]
    fn surrounding_whitespace_does_not_break_the_catalog_lookup() {
        let chips = line_designs(Some(&values(Some("  thobx  "), None, None, None, None)));
        assert_eq!(chips.len(), 1);
        assert!(chips[0].image.is_some());
    }

    #[test]
    fn blank_values_and_retail_lines_produce_no_chips() {
        let blank = values(Some("   "), None, None, None, None);
        assert!(line_designs(Some(&blank)).is_empty());
        assert!(line_designs(None).is_empty());
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
            payment_method: None,
            lines: Vec::new(),
            redemptions: Vec::new(),
            payments: Vec::new(),
            totals: InvoiceTotalsBreakdown {
                subtotal: 100.0,
                discount: 0.0,
                discount_unit: "amount".to_string(),
                discount_amount: 0.0,
                taxable: 90.91,
                vat_rate: 0.1,
                vat: 9.09,
                gift_card_sales: 0.0,
                total: 100.0,
                gift_card_redeemed: 0.0,
                amount_paid: 100.0,
                balance_due: 0.0,
            },
        }
    }
}
