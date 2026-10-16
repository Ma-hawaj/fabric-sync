//! Renders an order as a self-contained HTML document.
//!
//! The same reasoning applies as for the invoice document: HTML rather than a
//! PDF because Arabic needs a real text shaper and the browser already is one.
//! The page is printed to PDF by whatever renders it — today the user's
//! browser through an iframe, later a headless browser with no template
//! rewrite. Nothing in the page is fetched at render time.

use std::collections::BTreeMap;

use minijinja::{context, Environment};
use serde::Serialize;

use crate::{
    config::InvoiceBranding,
    document::{format_amount, format_datetime, format_quantity, CURRENCY},
    error::AppError,
    state::AppState,
};

use super::{service, types::OrderDetail, types::OrderListItem};

/// The copy of the template compiled into the binary, used unless
/// `INVOICE_TEMPLATE_DIR` points somewhere else (both documents live in the
/// same templates directory).
const DEFAULT_TEMPLATE: &str = include_str!("../../../templates/order.html");

const TEMPLATE_NAME: &str = "order.html";

/// The order design slots, in the order they render on the document — the same
/// order as the invoice document, so the two papers read the same way. A
/// stored value that matches nothing (orders that predate the catalog) prints
/// as a text-only chip rather than disappearing.
const SLOT_TITLES: [(&str, &str); 6] = [
    ("النوع", "Thobe"),
    ("الياقة", "Collar"),
    ("الكم", "Sleeve"),
    ("الجيب", "Pocket"),
    ("الباتي", "Patti"),
    ("EMD", "EMD"),
];

/// Which catalog section a slot's values are drawn from. EMD has no catalog
/// section — its chip always renders text-only.
const SLOT_SECTIONS: [&str; 6] = [
    "thob_type",
    "neck",
    "sleeve",
    "front_pocket",
    "patti",
    "emd",
];

/// One chip: a title, the resolved label and, when a catalog asset exists, a
/// self-contained `data:` URI for its image. Serialized camelCase — the
/// template reads `chip.titleAr`/`chip.titleEn`, and a snake_case key would
/// render as an empty title next to the image.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesignChip<'a> {
    title_ar: &'a str,
    title_en: &'a str,
    label: String,
    image: Option<String>,
}

fn design_asset(
    section: &str,
    slug: &str,
) -> Option<&'static crate::features::invoices::designs::DesignAsset> {
    crate::features::invoices::designs::DESIGNS
        .iter()
        .find(|asset| asset.section == section && asset.slug == slug)
}

/// A stored design value, trimmed. Matching is exact against the catalog id;
/// anything else stays text.
fn design_value(order: &OrderListItem, slot: usize) -> Option<&str> {
    let value = match slot {
        0 => order.thobe_type.as_deref(),
        1 => order.collar.as_deref(),
        2 => order.sleeve.as_deref(),
        3 => order.f_pocket.as_deref(),
        4 => order.patti.as_deref(),
        5 => order.emd.as_deref(),
        _ => return None,
    };
    let value = value?.trim();
    (!value.is_empty()).then_some(value)
}

/// The chips for the order, in fixed slot order, so a thobe always prints its
/// type first regardless of which fields were filled in.
fn order_designs(order: &OrderListItem) -> Vec<DesignChip<'static>> {
    SLOT_TITLES
        .iter()
        .enumerate()
        .filter_map(|(slot, (title_ar, title_en))| {
            let raw = design_value(order, slot)?;
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

fn data_uri(bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/webp;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// The free-text line note, trimmed. Not a design slot; printed beneath the
/// chips.
fn design_note(order: &OrderListItem) -> Option<String> {
    order
        .more_details
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string)
}

fn environment(branding: &InvoiceBranding) -> Result<Environment<'static>, AppError> {
    crate::document::template_environment(branding, TEMPLATE_NAME, DEFAULT_TEMPLATE)
}

pub async fn render_order_document(
    state: &AppState,
    order_id: uuid::Uuid,
) -> Result<String, AppError> {
    let detail = service::get_order(state, order_id).await?;
    let branding = state.invoice_branding();
    // Pre-formatted display strings (whole numbers trimmed), so the sheet
    // slots and the measurement table share one formatting.
    let thob_values = formatted_measurement(&detail);

    let env = environment(branding)?;
    let template = env.get_template(TEMPLATE_NAME)?;
    Ok(template.render(context! {
        order => minijinja::Value::from_serialize(&detail),
        // The parent invoice's creation moment, with the time of day —
        // pre-formatted, since the raw timestamp serializes as RFC 3339.
        invoice_date_time => format_datetime(&detail.order.invoice_date),
        company => minijinja::Value::from_serialize(branding),
        currency => CURRENCY,
        // Amounts are pre-formatted rather than left to the template, so that
        // editing the design can't accidentally change how money is written.
        amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
        // The design chips and the free-text note, so the order sheet carries
        // the same made-to-measure specification the invoice document prints
        // per line — a tailor cutting from this sheet must see every choice.
        designs => minijinja::Value::from_serialize(order_designs(&detail.order)),
        design_note => minijinja::Value::from_serialize(design_note(&detail.order)),
        // The thobe sheet: fixed slot geometry shared with the frontend
        // (`thob-diagram.tsx` THOBE_VALUE_SLOTS). Values print as plain
        // numbers at their slots, so there is nothing to lay out — the
        // template skips whatever the snapshot didn't record.
        thob_viewbox => THOB_VIEWBOX,
        thob_slots => minijinja::Value::from_serialize(thobe_slots()),
        thob_values => minijinja::Value::from_serialize(&thob_values),
        thob_front_paths => minijinja::Value::from_serialize(thobe_front_paths()),
        thob_front_ellipses => minijinja::Value::from_serialize(thobe_front_ellipses()),
        thob_back_paths => minijinja::Value::from_serialize(thobe_back_paths()),
        thob_back_ellipses => minijinja::Value::from_serialize(thobe_back_ellipses()),
        thob_dims => minijinja::Value::from_serialize(thobe_dims()),
        thob_arrows => minijinja::Value::from_serialize(thobe_arrows()),
    })?)
}

fn formatted_amounts(detail: &OrderDetail) -> BTreeMap<String, String> {
    let mut amounts = BTreeMap::new();

    amounts.insert(
        "materialAmount".into(),
        format_quantity(detail.order.material_amount),
    );
    amounts.insert("price".into(), format_amount(detail.order.price));
    amounts.insert(
        "total".into(),
        format_amount(detail.order.invoice_total_price),
    );
    amounts.insert(
        "amountPaid".into(),
        format_amount(detail.order.invoice_amount_paid),
    );
    amounts.insert(
        "balanceDue".into(),
        format_amount(detail.order.invoice_balance_due),
    );

    for (index, repair) in detail.order.repairs.iter().enumerate() {
        amounts.insert(format!("repair{index}"), format_amount(repair.charge));
    }

    amounts
}

fn push_number(values: &mut BTreeMap<String, String>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        // Trims the trailing ".0" off a whole number: 120 inches reads "120",
        // not "120.00".
        values.insert(key.to_string(), format_quantity(value));
    }
}

fn push_text(values: &mut BTreeMap<String, String>, key: &str, value: &Option<String>) {
    if let Some(value) = value {
        let value = value.trim();
        if !value.is_empty() {
            values.insert(key.to_string(), value.to_string());
        }
    }
}

/// Every recorded measurement as a display string, keyed by its camelCase
/// field name (the same keys `measurement_labels` and the sheet slots use in
/// the template). Only fields the snapshot actually captured appear — the
/// sheet renders a slot only for recorded values.
fn formatted_measurement(detail: &OrderDetail) -> BTreeMap<String, String> {
    let m = &detail.measurement;
    let mut values = BTreeMap::new();

    push_number(&mut values, "frontHeight", m.front_height);
    push_number(&mut values, "backHeight", m.back_height);
    push_number(&mut values, "shoulder", m.shoulder);
    push_number(&mut values, "shoulderDown", m.shoulder_down);
    push_number(&mut values, "chest", m.chest);
    push_number(&mut values, "chestUp", m.chest_up);
    push_number(&mut values, "waist", m.waist);
    push_number(&mut values, "hip", m.hip);
    push_number(&mut values, "sleeveLength", m.sleeve_length);
    push_number(&mut values, "neckSize", m.neck_size);
    push_number(&mut values, "neckWidth", m.neck_width);
    push_number(&mut values, "openHand", m.open_hand);
    push_number(&mut values, "openHandFolding", m.open_hand_folding);
    push_number(&mut values, "cuffWidth", m.cuff_width);
    push_number(&mut values, "cuffSize", m.cuff_size);
    push_number(&mut values, "armhole", m.armhole);
    push_number(&mut values, "foWidth", m.fo_width);
    push_number(&mut values, "fo", m.fo);
    push_number(&mut values, "bottom", m.bottom);
    push_number(&mut values, "bottomFold", m.bottom_fold);
    push_number(&mut values, "fullBody", m.full_body);
    push_number(&mut values, "sleeveHalf", m.sleeve_half);
    push_number(&mut values, "openFold", m.open_fold);
    push_number(&mut values, "frontPocketLength", m.front_pocket_length);

    push_text(
        &mut values,
        "frontPocketLengthByWidth",
        &m.front_pocket_length_by_width,
    );
    push_number(&mut values, "sidePocket", m.side_pocket);
    push_text(
        &mut values,
        "sidePocketLengthByWidth",
        &m.side_pocket_length_by_width,
    );
    push_text(
        &mut values,
        "mobilePocketLengthByWidth",
        &m.mobile_pocket_length_by_width,
    );
    // Record-level choices rather than lengths: what was measured and how to
    // cut it. Text, so they print as-is.
    push_text(&mut values, "type", &m.r#type);
    push_text(&mut values, "fit", &m.fit);

    values
}

// ---------------------------------------------------------------------------
// The thobe measurement sheet.
//
// The frontend (`thob-diagram.tsx` THOBE_VALUE_SLOTS) and this document draw
// the same front+back sheet: fixed slot coordinates, values printed as plain
// numbers. There is no caption layout to mirror — a value the snapshot
// didn't capture renders nothing, on screen and on paper alike. The
// front-pocket L×W stays one text slot; the sheet was fixed rather than
// splitting the stored field.

const THOB_VIEWBOX: &str = "0 -32 800 667";

#[derive(Serialize, Clone)]
struct ThobeSlot {
    id: &'static str,
    key: &'static str,
    label: &'static str,
    x: f64,
    y: f64,
    size: f64,
}

#[derive(Serialize, Clone)]
struct ThobePath {
    d: &'static str,
    grey: bool,
    dashed: bool,
}

#[derive(Serialize, Clone)]
struct ThobeEllipse {
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    transform: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stroke_width: Option<f64>,
    /// Render this ellipse only when the named slot has a recorded value —
    /// e.g. the yoke circle doubles as the full-body callout anchor.
    #[serde(skip_serializing_if = "Option::is_none")]
    show_when: Option<&'static str>,
}

/// Every value slot on the sheet, in the same order and with the same
/// coordinates as `THOBE_VALUE_SLOTS` on the frontend. `shoulderDown` reads
/// twice (front and back) off the one stored field.
fn thobe_slots() -> Vec<ThobeSlot> {
    let slot =
        |id: &'static str, key: &'static str, label: &'static str, x: f64, y: f64, size: f64| {
            ThobeSlot {
                id,
                key,
                label,
                x,
                y,
                size,
            }
        };
    vec![
        slot("neckSize", "neckSize", "Neck Size", 272.0, -4.0, 18.0),
        slot(
            "shoulderF",
            "shoulderDown",
            "Shoulder Down",
            358.0,
            19.0,
            18.0,
        ),
        slot("chestUp", "chestUp", "Chest Up", 153.0, 86.0, 16.0),
        slot(
            "frontPocketLength",
            "frontPocketLength",
            "Front Pocket Length",
            272.0,
            118.0,
            15.0,
        ),
        slot(
            "pocketLxW",
            "frontPocketLengthByWidth",
            "Pocket L×W",
            258.0,
            165.0,
            13.0,
        ),
        slot("fo", "fo", "Fo", 193.0, 152.0, 15.0),
        slot("foWidth", "foWidth", "Fo Width", 214.0, 254.0, 16.0),
        slot("cuffWidth", "cuffWidth", "Cuff Width", 68.0, 301.0, 13.0),
        slot("cuffSize", "cuffSize", "Cuff Size", 66.0, 346.0, 18.0),
        slot(
            "sidePocket",
            "sidePocket",
            "Side Pocket",
            274.0,
            364.0,
            18.0,
        ),
        slot(
            "frontHeight",
            "frontHeight",
            "Front Height",
            199.0,
            492.0,
            22.0,
        ),
        slot(
            "bottomFold",
            "bottomFold",
            "Bottom Fold",
            364.0,
            620.0,
            18.0,
        ),
        slot("neckWidth", "neckWidth", "Neck Width", 642.0, 20.0, 18.0),
        slot(
            "shoulderB",
            "shoulderDown",
            "Shoulder Down",
            396.0,
            56.0,
            18.0,
        ),
        slot("armhole", "armhole", "Armhole", 730.0, 46.0, 18.0),
        slot("fullBody", "fullBody", "Full Body", 567.5, 93.0, 17.0),
        slot("chest", "chest", "Chest", 520.0, 134.0, 20.0),
        slot(
            "sleeveHalf",
            "sleeveHalf",
            "Sleeve Half",
            675.0,
            154.0,
            14.0,
        ),
        slot("waist", "waist", "Waist", 520.0, 215.0, 20.0),
        slot("hip", "hip", "Hip", 520.0, 305.0, 20.0),
        slot(
            "sleeveLength",
            "sleeveLength",
            "Sleeve Length",
            756.0,
            214.0,
            18.0,
        ),
        slot("openFold", "openFold", "Open Fold", 712.0, 303.0, 13.0),
        slot("openHand", "openHand", "Open Hand", 712.0, 356.0, 20.0),
        slot(
            "backHeight",
            "backHeight",
            "Back Height",
            567.5,
            492.0,
            22.0,
        ),
        slot("bottom", "bottom", "Bottom", 724.0, 622.0, 18.0),
    ]
}

fn path(d: &'static str) -> ThobePath {
    ThobePath {
        d,
        grey: false,
        dashed: false,
    }
}

fn thobe_front_paths() -> Vec<ThobePath> {
    vec![
        path("M181 35 Q146 44 108.5 67"),
        path("M181 41 Q148 50 113.5 71"),
        path("M246 35 Q282 44 319 67"),
        path("M246 41 Q280 50 317.5 71"),
        path("M108.5 68 L39.5 298"),
        path("M108.5 68 Q122 90 126 112"),
        path("M125.5 200 L92 313"),
        path("M46.5 274.5 Q72.8 277.9 99 289"),
        path("M320 68 L388.75 298.75"),
        path("M320 68 Q305 91 301 114"),
        path("M303 198 L337 313.75"),
        path("M330 289.3 Q354.5 275.5 382 275.7"),
        path("M126 112 Q124 330 110 602"),
        path("M301 114 Q303 330 320 602"),
        ThobePath {
            d: "M126 70 V112 M302.5 70 V114",
            grey: true,
            dashed: false,
        },
        path("M110 580 Q215 625 320 580"),
        path("M110 602 Q215 648 320 602"),
        path("M181 40 V600"),
        path("M205 50 V218 L213.5 231 L222 218 V52"),
        path("M205 205 H222"),
        path("M235 128.5 H290.5 V174 L281.5 185 H242.5 L235 174 Z"),
        path("M235 136 H290.5"),
    ]
}

fn thobe_front_ellipses() -> Vec<ThobeEllipse> {
    vec![
        ThobeEllipse {
            cx: 213.5,
            cy: 39.5,
            rx: 32.5,
            ry: 24.5,
            transform: None,
            stroke_width: None,
            show_when: None,
        },
        ThobeEllipse {
            cx: 213.5,
            cy: 39.0,
            rx: 32.5,
            ry: 11.5,
            transform: None,
            stroke_width: None,
            show_when: None,
        },
        ThobeEllipse {
            cx: 65.75,
            cy: 305.5,
            rx: 27.3,
            ry: 7.5,
            transform: Some("rotate(16 65.75 305.5)"),
            stroke_width: None,
            show_when: None,
        },
        ThobeEllipse {
            cx: 362.9,
            cy: 306.25,
            rx: 26.9,
            ry: 7.5,
            transform: Some("rotate(-16.2 362.9 306.25)"),
            stroke_width: None,
            show_when: None,
        },
    ]
}

fn thobe_back_paths() -> Vec<ThobePath> {
    vec![
        path("M535 36 L537 25 Q541 15 567.5 15 Q594 15 598 25 L600 36 Z"),
        path("M535 36 Q499 46 462 68.5"),
        path("M600 36 Q636 46 672 68"),
        path("M462 68.5 L398.75 297.5"),
        path("M462 68.5 L479 116"),
        path("M478.5 198 L448.5 313.5"),
        path("M405 274.5 Q431.3 273 455.4 287"),
        path("M672 68 L735 300"),
        path("M672 68 L653 116"),
        path("M653.5 199 L684.5 315"),
        path("M677.4 288 Q701 275.9 728.3 275.5"),
        path("M479 116 Q477 330 463 605"),
        path("M653 116 Q656 330 679 605"),
        path("M463 587 Q571 633 679 587"),
        path("M463 605 Q571 650 679 605"),
        path("M567.5 36 V610"),
        ThobePath {
            d: "M672 67.5 H677.5 L741.5 299 H735",
            grey: false,
            dashed: true,
        },
    ]
}

fn thobe_back_ellipses() -> Vec<ThobeEllipse> {
    vec![
        ThobeEllipse {
            cx: 567.5,
            cy: 88.0,
            rx: 62.0,
            ry: 13.0,
            transform: None,
            stroke_width: Some(1.0),
            show_when: Some("fullBody"),
        },
        ThobeEllipse {
            cx: 423.6,
            cy: 305.5,
            rx: 26.1,
            ry: 7.5,
            transform: Some("rotate(17.8 423.6 305.5)"),
            stroke_width: None,
            show_when: None,
        },
        ThobeEllipse {
            cx: 709.75,
            cy: 307.5,
            rx: 26.3,
            ry: 7.5,
            transform: Some("rotate(-16.5 709.75 307.5)"),
            stroke_width: None,
            show_when: None,
        },
    ]
}

/// Thin dimension/leader lines, front and back combined.
fn thobe_dims() -> Vec<&'static str> {
    vec![
        "M320 8 V56",
        "M128 92 H299",
        "M241 98 V122",
        "M262 -1 L226 31",
        "M297 330 V392",
        "M322 604 L342 612",
        "M468 64 L452 53.5",
        "M676 65 L697 53",
        "M598 25 L618 17",
        "M653 118 H554",
        "M640 199 H554",
        "M479 117 H488",
        "M479 199 H488",
        "M479 289 H490",
        "M556 289 H656",
        "M655 160 H695",
        "M681 607 L702 614",
    ]
}

/// Filled arrowheads for the dimension lines.
fn thobe_arrows() -> Vec<&'static str> {
    vec![
        "M320 64 l-4.5 -9 h9 z",
        "M128 92 l8 -3.5 v7 z",
        "M299 92 l-8 -3.5 v7 z",
        "M241 129 l-3.5 -8 h7 z",
        "M297 330 l-3.5 8 h7 z",
        "M297 392 l-3.5 -8 h7 z",
        "M449.5 52 l9.5 1.5 l-4.5 7 z",
        "M698.5 52 l-9.5 0 l3.5 7.5 z",
        "M549 118 l9 -4 v8 z",
        "M495 117 l-8 -3.5 v7 z",
        "M549 199 l9 -4 v8 z",
        "M497 199 l-7 -3.5 v7 z",
        "M497 289 l-7 -3.5 v7 z",
        "M553 289 l7 -3.5 v7 z",
        "M655 160 l7 -3 v6 z",
        "M695 160 l-7 -3 v6 z",
    ]
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
    fn the_default_template_compiles() {
        let env = environment(&branding()).unwrap();
        assert!(env.get_template(TEMPLATE_NAME).is_ok());
    }

    #[test]
    fn amounts_are_pre_formatted_and_balance_is_floored_at_zero() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };

        let amounts = formatted_amounts(&detail);
        assert_eq!(amounts["materialAmount"], "3.5");
        assert_eq!(amounts["price"], "100.000");
        assert_eq!(amounts["total"], "300.000");
        assert_eq!(amounts["amountPaid"], "120.000");
        // The balance arrives floored at zero from the query — a document
        // never prints a negative due, even on an overpaid legacy invoice.
        assert_eq!(amounts["balanceDue"], "180.000");
    }

    #[test]
    fn measurements_are_formatted_for_the_sheet_slots() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };

        let values = formatted_measurement(&detail);
        assert_eq!(values["frontHeight"], "120");
        assert_eq!(values["chest"], "50");
        assert_eq!(values["sleeveLength"], "60");
        // Everything the fixture didn't capture stays off the sheet.
        assert!(!values.contains_key("waist"));
        assert!(!values.contains_key("backHeight"));
    }

    #[cfg(test)]
    fn test_render(detail: &OrderDetail, branding: &InvoiceBranding) -> String {
        let env = environment(branding).unwrap();
        let template = env.get_template(TEMPLATE_NAME).unwrap();
        let thob_values = formatted_measurement(detail);
        template
            .render(context! {
                order => minijinja::Value::from_serialize(detail),
                company => minijinja::Value::from_serialize(branding),
                currency => CURRENCY,
                amounts => minijinja::Value::from_serialize(formatted_amounts(detail)),
                designs => minijinja::Value::from_serialize(order_designs(&detail.order)),
                design_note => minijinja::Value::from_serialize(design_note(&detail.order)),
                thob_viewbox => THOB_VIEWBOX,
                thob_slots => minijinja::Value::from_serialize(thobe_slots()),
                thob_values => minijinja::Value::from_serialize(&thob_values),
                thob_front_paths => minijinja::Value::from_serialize(thobe_front_paths()),
                thob_front_ellipses => minijinja::Value::from_serialize(thobe_front_ellipses()),
                thob_back_paths => minijinja::Value::from_serialize(thobe_back_paths()),
                thob_back_ellipses => minijinja::Value::from_serialize(thobe_back_ellipses()),
                thob_dims => minijinja::Value::from_serialize(thobe_dims()),
                thob_arrows => minijinja::Value::from_serialize(thobe_arrows()),
            })
            .unwrap()
    }

    #[test]
    fn the_template_renders_the_thobe_sheet() {
        let mut measurement = tests_support::measurement();
        measurement.back_height = Some(124.0);
        measurement.waist = Some(38.5);
        measurement.front_pocket_length_by_width = Some("No 16x14".to_string());
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement,
        };
        let html = test_render(&detail, &branding());

        // One sheet, front and back together.
        assert!(html.contains("Thobe Sheet"));
        assert!(html.contains("0 -32 800 667"));
        // The shorter tables stack in one column beside Body dimensions.
        assert!(html.contains("<div class=\"measurement-stack\">"));
        // Every drawn ellipse (collars, cuffs) carries the garment class —
        // without it SVG falls back to a solid black fill on the paper.
        // Six here: the yoke is gated on fullBody, which isn't recorded.
        assert_eq!(html.matches("<ellipse class=\"thob-garment\"").count(), 6);
        // The document is titled by the order's own readable number, not an
        // id prefix.
        assert!(html.contains("ORD-12"));
        // The material prints as its SKU, not its name.
        assert!(html.contains("CTN-001"));
        assert!(!html.contains("Cotton"));
        // Recorded values print as plain numbers at their slots, whole
        // numbers trimmed.
        assert!(html.contains(">120</text>"));
        assert!(html.contains(">124</text>"));
        assert!(html.contains(">60</text>"));
        assert!(html.contains(">38.5</text>"));
        assert!(html.contains("No 16x14"));
        // No units ride the slots.
        assert!(!html.contains("inch"));
        // Unrecorded fields render nothing on the sheet — no slot group at
        // all. (Cuff Size appears nowhere else on the page: the measurement
        // table only lists recorded fields.)
        assert!(!html.contains("<title>Cuff Size</title>"));
        // The yoke circle doubles as the full-body anchor: hidden until that
        // value is recorded...
        assert!(!html.contains("cx=\"567.5\""));

        // ...and drawn with it, alongside the other six ellipses.
        let mut bodied = tests_support::measurement();
        bodied.full_body = Some(150.0);
        let bodied_detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: bodied,
        };
        let bodied_html = test_render(&bodied_detail, &branding());
        assert!(bodied_html.contains("cx=\"567.5\""));
        assert_eq!(
            bodied_html
                .matches("<ellipse class=\"thob-garment\"")
                .count(),
            7
        );
    }

    #[test]
    fn design_chips_follow_the_fixed_slot_order() {
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());
        order.collar = Some("3".to_string());
        order.sleeve = Some("open".to_string());
        order.f_pocket = Some("round".to_string());
        order.patti = Some("normal".to_string());
        order.emd = Some("6".to_string());

        let chips = order_designs(&order);
        assert_eq!(
            chips.iter().map(|c| c.title_en).collect::<Vec<_>>(),
            vec!["Thobe", "Collar", "Sleeve", "Pocket", "Patti", "EMD"]
        );
        // Catalog slugs resolve to their display labels.
        assert_eq!(
            chips.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(),
            vec!["Thobx", "3", "Open", "Round", "Normal", "6"]
        );
    }

    #[test]
    fn emd_has_no_catalog_section_so_it_prints_text_only() {
        let mut order = services_order();
        order.emd = Some("6".to_string());

        let chips = order_designs(&order);
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].title_en, "EMD");
        assert_eq!(chips[0].label, "6");
        assert!(chips[0].image.is_none());
    }

    #[test]
    fn a_catalog_design_carries_a_webp_data_uri() {
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());

        let chips = order_designs(&order);
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].label, "Thobx");
        let image = chips[0].image.as_deref().unwrap();
        assert!(image.starts_with("data:image/webp;base64,"));
        assert!(!image.split_once(',').unwrap().1.is_empty());
    }

    #[test]
    fn an_uncatalogued_value_prints_as_a_text_only_chip() {
        // Orders that predate the catalog store human values like "Saudi";
        // those still have to survive onto the document.
        let mut order = services_order();
        order.thobe_type = Some("Saudi".to_string());
        order.collar = Some("Round".to_string());
        order.sleeve = Some("Cuff".to_string());

        let chips = order_designs(&order);
        assert_eq!(chips.len(), 3);
        for chip in &chips {
            assert!(chip.image.is_none());
        }
        assert_eq!(chips[2].label, "Cuff");
    }

    #[test]
    fn blank_values_produce_no_chips_and_blank_notes_produce_no_note() {
        let mut order = services_order();
        order.thobe_type = Some("   ".to_string());
        order.more_details = Some("  ".to_string());

        assert!(order_designs(&order).is_empty());
        assert_eq!(design_note(&order), None);

        let mut noted = services_order();
        noted.more_details = Some("  double stitching  ".to_string());
        assert_eq!(design_note(&noted).as_deref(), Some("double stitching"));
    }

    #[test]
    fn chips_serialize_camelcase_for_the_template() {
        // The template reads `chip.titleAr`/`chip.titleEn` — a snake_case key
        // would look the chip up as missing and render an empty title next to
        // the image, leaving no clue which slot the image belongs to.
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());

        let value = serde_json::to_value(order_designs(&order)).unwrap();
        assert_eq!(value[0]["titleAr"], "النوع");
        assert_eq!(value[0]["titleEn"], "Thobe");
        assert_eq!(value[0]["label"], "Thobx");
        assert!(value[0]["image"].as_str().is_some());
    }

    #[test]
    fn the_template_names_each_design_slot_beside_its_image() {
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());
        order.collar = Some("Saudi".to_string());
        order.more_details = Some("double stitching".to_string());
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());

        // Each chip names its slot, so the image is
        // identifiable even when the stored value itself is cryptic ("3").
        assert!(html.contains("Thobe"));
        assert!(html.contains("Collar"));
        // Catalog matches print their display label with the raster...
        assert!(html.contains("Thobx"));
        // ...while legacy values print as text-only chips rather than
        // disappearing.
        assert!(html.contains("Saudi"));
        assert!(html.contains("double stitching"));
        // The free-text note prints below the diagram, not in the sidebar.
        let svg_end = html.find("</svg>").unwrap();
        let note = html.find("double stitching").unwrap();
        assert!(note > svg_end);
        // Two choices fit the sidebar — no overflow strip is rendered below
        // the sheet. (Matched on the div: the stylesheet always names the
        // class.)
        assert!(!html.contains("<div class=\"design-overflow\">"));
    }

    #[test]
    fn extra_design_choices_overflow_below_the_sheet() {
        // All six slots filled: five stack in the sidebar, the sixth flows
        // below the diagram so the side-by-side balance never stretches.
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());
        order.collar = Some("Saudi".to_string());
        order.sleeve = Some("open".to_string());
        order.f_pocket = Some("round".to_string());
        order.patti = Some("normal".to_string());
        order.emd = Some("6".to_string());
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());

        assert_eq!(html.matches("<div class=\"design-cell\">").count(), 5);
        assert_eq!(html.matches("design-cell-overflow").count(), 1);
    }

    #[test]
    fn paired_measurements_share_a_row_despite_gaps_above() {
        // neckSize recorded while sleeveHalf (two rows up) is not: neck size
        // must still sit beside neck width instead of sliding up the grid.
        let mut measurement = tests_support::measurement();
        measurement.neck_size = Some(22.0);
        measurement.neck_width = Some(18.0);
        measurement.front_pocket_length_by_width = Some("No 16x14".to_string());
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement,
        };
        let html = test_render(&detail, &branding());

        // Labels match the entry form, including the L×W pocket fields.
        assert!(html.contains(">Neck Size</span>"));
        assert!(html.contains(">Neck Width</span>"));
        assert!(html.contains("Pocket L×W"));
        // Neck size and neck width share one row: no further row starts between
        // the two cells. (The stylesheet's own `.m-row` sits before the
        // body, so the search starts at the neck cell.)
        let neck = html.find(">Neck Size</span>").unwrap();
        let neck_width = html.find(">Neck Width</span>").unwrap();
        let next_row = neck + html[neck..].find("m-row").unwrap();
        assert!(neck_width < next_row);
        // The unrecorded half of the sleeve row renders as a blank
        // placeholder that holds the column.
        assert!(html.contains("m-empty"));
    }

    #[test]
    fn sheet_slots_stay_inside_the_viewbox() {
        // The sheet spans x 0..800 and y -32..635.
        for slot in thobe_slots() {
            assert!(
                slot.x >= 0.0 && slot.x <= 800.0,
                "{}: x out of bounds",
                slot.id
            );
            assert!(
                slot.y >= -32.0 && slot.y <= 635.0,
                "{}: y out of bounds",
                slot.id
            );
        }
    }
}

#[cfg(test)]
fn services_order() -> crate::features::orders::types::OrderListItem {
    use crate::features::orders::types::OrderListItem;
    OrderListItem {
        id: uuid::Uuid::nil(),
        order_number: 12,
        invoice_id: uuid::Uuid::nil(),
        invoice_number: 7,
        invoice_date: chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2026, 7, 30, 9, 30, 0)
            .unwrap(),
        measurement_id: uuid::Uuid::nil(),
        customer_name: "Ahmed".to_string(),
        customer_mobile: "+973 0000".to_string(),
        material: "Cotton".to_string(),
        material_sku: Some("CTN-001".to_string()),
        material_amount: 3.5,
        price: 100.0,
        status: "pending".to_string(),
        received_at: None,
        thobe_type: None,
        f_pocket: None,
        collar: None,
        sleeve: None,
        patti: None,
        emd: None,
        more_details: None,
        production_location_id: None,
        production_location: None,
        production_location_inferred: false,
        receiving_location_id: None,
        receiving_location: None,
        stages: Vec::new(),
        current_stage: None,
        repairs: Vec::new(),
        invoice_total_price: 300.0,
        invoice_amount_paid: 120.0,
        invoice_payment_status: "partial".to_string(),
        invoice_balance_due: 180.0,
        invoice_gift_card_redeemed: 0.0,
        invoice_payment_method: None,
    }
}

#[cfg(test)]
mod tests_support {
    use crate::features::customers::types::Measurement;

    pub fn measurement() -> Measurement {
        Measurement {
            id: uuid::Uuid::nil(),
            customer_id: uuid::Uuid::nil(),
            date: chrono::NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
            r#type: Some("body".to_string()),
            fit: Some("medium".to_string()),
            front_height: Some(120.0),
            back_height: None,
            chest: Some(50.0),
            waist: None,
            hip: None,
            shoulder: None,
            shoulder_down: None,
            sleeve_length: Some(60.0),
            neck_size: None,
            open_hand: None,
            open_hand_folding: None,
            chest_up: None,
            cuff_width: None,
            cuff_size: None,
            neck_width: None,
            armhole: None,
            fo_width: None,
            fo: None,
            bottom: None,
            bottom_fold: None,
            full_body: None,
            sleeve_half: None,
            open_fold: None,
            front_pocket_length: None,
            front_pocket_length_by_width: None,
            side_pocket: None,
            side_pocket_length_by_width: None,
            mobile_pocket_length_by_width: None,
        }
    }
}
