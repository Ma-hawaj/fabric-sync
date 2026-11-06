//! Renders an order as a self-contained HTML document.
//!
//! The same reasoning applies as for the invoice document: HTML rather than a
//! PDF because Arabic needs a real text shaper and the browser already is one.
//! The page is printed to PDF by whatever renders it — today the user's
//! browser through an iframe, later a headless browser with no template
//! rewrite. Nothing in the page is fetched at render time.

use std::collections::BTreeMap;
use std::collections::{HashMap, HashSet};

use minijinja::{context, Environment};
use serde::Serialize;

use crate::{
    config::InvoiceBranding,
    document::{format_date, format_datetime, format_measurement},
    error::AppError,
    features::design_options::{service as design_catalog, types::DesignAsset as CatalogAsset},
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
const SLOT_TITLES: [(&str, &str); 7] = [
    ("النوع", "Thobe"),
    ("الياقة", "Collar"),
    ("الكم", "Sleeve"),
    ("الجيب", "Pocket"),
    ("الجيب الجانبي", "Side Pocket"),
    ("الباتي", "Patti"),
    ("EMD", "EMD"),
];

/// Which catalog category a slot's values are drawn from. A slot whose value
/// matches no row (or a row with no upload yet, as EMD starts out) renders a
/// text-only chip rather than disappearing.
const SLOT_SECTIONS: [&str; 7] = [
    "thob_type",
    "neck",
    "sleeve",
    "front_pocket",
    "side_pocket",
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

fn static_asset(
    section: &str,
    slug: &str,
) -> Option<&'static crate::features::invoices::designs::DesignAsset> {
    crate::features::invoices::designs::DESIGNS
        .iter()
        .find(|asset| asset.section == section && asset.slug == slug)
}

/// A stored design value resolved to its display label plus illustration. The
/// database row wins (staff-renamed labels, newly uploaded pictures); a row
/// without an upload yet keeps its label but falls back to the compiled-in
/// picture; anything else stays text — a legacy free-text value like "Saudi"
/// still prints.
fn resolve_design(
    category: &str,
    raw: &str,
    catalog: &HashMap<(String, String), CatalogAsset>,
) -> (String, Option<String>) {
    if let Some(asset) = catalog.get(&(category.to_string(), raw.to_string())) {
        let image = asset
            .image
            .as_deref()
            .map(|bytes| data_uri(&asset.image_mime, bytes))
            .or_else(|| static_asset(category, raw).map(|old| data_uri("image/webp", old.bytes)));
        return (asset.label.clone(), image);
    }
    match static_asset(category, raw) {
        Some(asset) => (
            asset.label.to_string(),
            Some(data_uri("image/webp", asset.bytes)),
        ),
        None => (raw.to_string(), None),
    }
}

/// A stored design value, trimmed. Matching is exact against the catalog id;
/// anything else stays text.
fn design_value(order: &OrderListItem, slot: usize) -> Option<&str> {
    let value = match slot {
        0 => order.thobe_type.as_deref(),
        1 => order.collar.as_deref(),
        2 => order.sleeve.as_deref(),
        3 => order.f_pocket.as_deref(),
        4 => order.s_pocket.as_deref(),
        5 => order.patti.as_deref(),
        6 => order.emd.as_deref(),
        _ => return None,
    };
    let value = value?.trim();
    (!value.is_empty()).then_some(value)
}

/// Every stored design value on the order, as `(category, slug)` pairs with
/// blanks dropped — the document resolves all of them in one batched query.
fn design_pairs(order: &OrderListItem) -> Vec<(String, String)> {
    [
        ("thob_type", &order.thobe_type),
        ("neck", &order.collar),
        ("sleeve", &order.sleeve),
        ("front_pocket", &order.f_pocket),
        ("side_pocket", &order.s_pocket),
        ("patti", &order.patti),
        ("emd", &order.emd),
    ]
    .into_iter()
    .filter_map(|(category, value)| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| (category.to_string(), value.to_string()))
    })
    .collect()
}

/// Design choices in fixed slot order. Thobe type is text in the order column,
/// never an illustration in the design grid.
fn order_designs(
    order: &OrderListItem,
    catalog: &HashMap<(String, String), CatalogAsset>,
) -> Vec<DesignChip<'static>> {
    SLOT_TITLES
        .iter()
        .enumerate()
        .skip(1)
        .filter_map(|(slot, (title_ar, title_en))| {
            let raw = design_value(order, slot)?;
            let (label, image) = resolve_design(SLOT_SECTIONS[slot], raw, catalog);
            Some(DesignChip {
                title_ar,
                title_en,
                label,
                image,
            })
        })
        .collect()
}

fn data_uri(mime: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:{mime};base64,{}",
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

/// One complete production row; no financial fields are printed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductionRow<'a> {
    order: &'a OrderListItem,
    thobe_type: Option<String>,
    designs: Vec<DesignChip<'static>>,
    design_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductionSheet<'a> {
    order: &'a OrderDetail,
    invoice_date_time: String,
    thob_values: BTreeMap<String, String>,
    rows: Vec<ProductionRow<'a>>,
}

fn production_sheets<'a>(
    details: &'a [OrderDetail],
    catalog: &HashMap<(String, String), CatalogAsset>,
    timezone: chrono_tz::Tz,
) -> Vec<ProductionSheet<'a>> {
    let mut sheets: Vec<ProductionSheet<'a>> = Vec::new();
    for detail in details {
        let row = ProductionRow {
            order: &detail.order,
            thobe_type: design_value(&detail.order, 0)
                .map(|raw| resolve_design("thob_type", raw, catalog).0),
            designs: order_designs(&detail.order, catalog),
            design_note: design_note(&detail.order),
        };
        // Different snapshots must never share a diagram, even for the same
        // customer. Preserve the order-number ordering supplied by the query.
        if let Some(sheet) = sheets
            .iter_mut()
            .find(|sheet| sheet.order.measurement.id == detail.measurement.id)
        {
            sheet.rows.push(row);
        } else {
            sheets.push(ProductionSheet {
                order: detail,
                invoice_date_time: format_datetime(&detail.order.invoice_date, timezone),
                thob_values: formatted_measurement(detail),
                rows: vec![row],
            });
        }
    }
    sheets
}

pub async fn render_order_document(
    state: &AppState,
    order_id: uuid::Uuid,
) -> Result<String, AppError> {
    let (details, target_date) = service::order_document_details(state, order_id).await?;
    // Resolve every order's catalog choices in a single batch.
    let pairs: HashSet<(String, String)> = details
        .iter()
        .flat_map(|detail| design_pairs(&detail.order))
        .collect();
    let catalog = design_catalog::lookup_map(state, &pairs).await?;
    render_document(
        &details,
        state.invoice_branding(),
        &catalog,
        state.timezone()?,
        target_date,
    )
}

fn render_document(
    details: &[OrderDetail],
    branding: &InvoiceBranding,
    catalog: &HashMap<(String, String), CatalogAsset>,
    timezone: chrono_tz::Tz,
    target_date: Option<chrono::NaiveDate>,
) -> Result<String, AppError> {
    let env = environment(branding)?;
    let template = env.get_template(TEMPLATE_NAME)?;
    Ok(template.render(context! {
        sheets => minijinja::Value::from_serialize(production_sheets(details, catalog, timezone)),
        company => minijinja::Value::from_serialize(branding),
        target_date => target_date.as_ref().map(format_date),
        thob_viewbox => THOB_VIEWBOX,
        thob_slots => minijinja::Value::from_serialize(thobe_slots()),
        thob_front_paths => minijinja::Value::from_serialize(thobe_front_paths()),
        thob_front_ellipses => minijinja::Value::from_serialize(thobe_front_ellipses()),
        thob_back_paths => minijinja::Value::from_serialize(thobe_back_paths()),
        thob_back_ellipses => minijinja::Value::from_serialize(thobe_back_ellipses()),
        thob_dims => minijinja::Value::from_serialize(thobe_dims()),
        thob_arrows => minijinja::Value::from_serialize(thobe_arrows()),
    })?)
}

fn push_number(values: &mut BTreeMap<String, String>, key: &str, value: Option<f64>) {
    if let Some(value) = value {
        values.insert(key.to_string(), format_measurement(value));
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
/// field name (the same keys the sheet slots use in the template). Only fields
/// the snapshot actually captured appear.
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
/// coordinates as `THOBE_VALUE_SLOTS` on the frontend. The front shoulder
/// slot reads the drop and the back one the plain shoulder width.
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
            320.0,
            2.0,
            18.0,
        ),
        slot("chestUp", "chestUp", "Chest Up", 153.0, 86.0, 16.0),
        slot(
            "frontPocketLength",
            "frontPocketLength",
            "Front Pocket Length",
            246.0,
            120.0,
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
        slot("neckWidth", "neckWidth", "Neck Width", 630.0, 20.0, 18.0),
        slot("shoulderB", "shoulder", "Shoulder", 433.0, 48.0, 18.0),
        slot("armhole", "armhole", "Armhole", 713.0, 50.0, 18.0),
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
            d: "M126 70 V112 M300 70 V114",
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
        "M246 42 V105",
        "M262 -1 L226 31",
        "M297 330 V392",
        "M322 604 L342 612",
        "M468 64 L452 53.5",
        "M676 65 L697 53",
        "M598 25 L618 17",
        "M653 118 H554",
        "M653 199 H554",
        "M479 117 H488",
        "M479 199 H490",
        "M476 289 H490",
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
        "M246 105 l-3.5 -8 h7 z",
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

    /// An empty catalog, so the lookup falls back to the compiled-in one —
    /// what the documents behaved like before the database catalog existed.
    fn empty_catalog() -> HashMap<(String, String), CatalogAsset> {
        HashMap::new()
    }

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
    fn the_order_sheet_prints_the_readable_customer_id() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());
        assert!(html.contains("<dt>Customer ID</dt>"));
        assert!(html.contains("<dd dir=\"ltr\">C-23</dd>"));
        assert!(!html.contains("Measurement ID"));
        assert!(!html.contains("C-23-001"));
        assert!(!html.contains("Measured on"));
    }

    #[sqlx::test]
    async fn the_document_uses_the_customer_of_each_order(pool: sqlx::PgPool) {
        let (_, orders, _, _) = crate::test_support::invoice(&pool, 2, false).await;
        let customer_id: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO customers(name,mobile_no) VALUES('Second Customer','33112233') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let measurement_id: uuid::Uuid =
            sqlx::query_scalar("INSERT INTO measurements(customer_id) VALUES($1) RETURNING id")
                .bind(customer_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("UPDATE orders SET measurement_id=$1 WHERE id=$2")
            .bind(measurement_id)
            .bind(orders[1])
            .execute(&pool)
            .await
            .unwrap();

        let state = crate::test_support::state(pool, None, None).await;
        for (order, number) in orders.iter().zip([1, 2]) {
            let detail = service::get_order(&state, *order).await.unwrap();
            assert_eq!(detail.order.customer_number, number);
            let html = render_order_document(&state, *order).await.unwrap();
            assert!(html.contains(&format!("<dd dir=\"ltr\">C-{number}</dd>")));
            assert!(!html.contains("Measurement ID"));
        }
    }

    #[test]
    fn measurements_are_formatted_for_the_sheet_slots() {
        let mut measurement = tests_support::measurement();
        measurement.shoulder = Some(17.625);
        measurement.neck_width = Some(7.123);
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement,
        };

        let values = formatted_measurement(&detail);
        assert_eq!(values["frontHeight"], "120");
        assert_eq!(values["chest"], "50");
        assert_eq!(values["sleeveLength"], "60");
        assert_eq!(values["shoulder"], "17 ⅝");
        assert_eq!(values["neckWidth"], "7.123");
        // Everything the fixture didn't capture stays off the sheet.
        assert!(!values.contains_key("waist"));
        assert!(!values.contains_key("backHeight"));
    }

    #[cfg(test)]
    #[test]
    fn customer_fabric_is_labeled_and_escaped_on_the_order_sheet() {
        let mut order = services_order();
        order.material_source = "customer".into();
        order.material = "White <linen>".into();
        order.material_sku = None;
        order.is_urgent = true;
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());
        assert!(html.contains("Customer-provided material"));
        assert!(html.contains("White &lt;linen&gt;"));
        assert!(html.contains("Urgent"));
    }

    fn test_render(detail: &OrderDetail, branding: &InvoiceBranding) -> String {
        render_document(
            std::slice::from_ref(detail),
            branding,
            &empty_catalog(),
            chrono_tz::Asia::Bahrain,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap()),
        )
        .unwrap()
    }

    #[test]
    fn fraction_values_and_escaped_text_stay_on_the_diagram() {
        let mut measurement = tests_support::measurement();
        measurement.waist = Some(38.5);
        measurement.front_pocket_length = Some(6.125);
        measurement.fo_width = Some(3.75);
        measurement.chest_up = Some(7.13);
        measurement.neck_width = Some(0.0);
        measurement.front_pocket_length_by_width = Some("No <16x14>".to_string());
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement,
        };
        let html = test_render(&detail, &branding());
        let diagram = &html;

        for value in ["38 ½", "6 ⅛", "3 ¾", "7.13", "0", "No &lt;16x14&gt;"] {
            assert!(
                diagram.contains(&format!(">{value}</text>")),
                "diagram: {value}"
            );
        }
        assert!(html.contains("<dt>Type</dt><dd>body</dd>"));
        assert!(html.contains("<dt>Fit</dt><dd>medium</dd>"));
        assert!(!html.contains("measurement-grid"));
        assert!(!html.contains("Body dimensions"));
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
        assert!(!html.contains("measurement-stack"));
        // Every drawn ellipse (collars, cuffs) carries the garment class —
        // without it SVG falls back to a solid black fill on the paper.
        // Six here: the yoke is gated on fullBody, which isn't recorded.
        assert_eq!(html.matches("<ellipse class=\"thob-garment\"").count(), 6);
        // The document is titled by the order's own readable number, not an
        // id prefix.
        assert!(html.contains("ORD-12"));
        // The material name and SKU both remain on the production sheet.
        assert!(html.contains("CTN-001"));
        assert!(html.contains("Cotton"));
        assert!(!html.contains("Quantity:"));
        assert!(!html.contains("Made at:"));
        assert!(!html.contains("Collection:"));
        // Recorded values print as plain numbers at their slots, whole
        // numbers trimmed.
        assert!(html.contains(">120</text>"));
        assert!(html.contains(">124</text>"));
        assert!(html.contains(">60</text>"));
        assert!(html.contains(">38 ½</text>"));
        assert!(html.contains("No 16x14"));
        // No units ride the slots.
        assert!(!html.contains("inch"));
        // Unrecorded fields render no slot group on the diagram.
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
        order.s_pocket = Some("type-2".to_string());
        order.patti = Some("normal".to_string());
        order.emd = Some("6".to_string());

        let chips = order_designs(&order, &empty_catalog());
        assert_eq!(
            chips.iter().map(|c| c.title_en).collect::<Vec<_>>(),
            vec!["Collar", "Sleeve", "Pocket", "Side Pocket", "Patti", "EMD"]
        );
        // Catalog slugs resolve to their display labels.
        assert_eq!(
            chips.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(),
            vec!["3", "Open", "Round", "type-2", "Normal", "6"]
        );
    }

    #[test]
    fn emd_without_an_uploaded_illustration_prints_text_only() {
        let mut order = services_order();
        order.emd = Some("6".to_string());

        let chips = order_designs(&order, &empty_catalog());
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].title_en, "EMD");
        assert_eq!(chips[0].label, "6");
        assert!(chips[0].image.is_none());
    }

    #[test]
    fn a_catalog_design_carries_a_webp_data_uri() {
        let mut order = services_order();
        order.sleeve = Some("open".to_string());

        let chips = order_designs(&order, &empty_catalog());
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].label, "Open");
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

        let chips = order_designs(&order, &empty_catalog());
        assert_eq!(chips.len(), 2);
        for chip in &chips {
            assert!(chip.image.is_none());
        }
        assert_eq!(chips[1].label, "Cuff");
    }

    #[test]
    fn a_database_row_overrides_the_compiled_in_label_and_image() {
        // Staff renamed the option and uploaded a PNG: the printout follows
        // the row, including the mime in the data URI.
        let catalog = HashMap::from([(
            ("sleeve".to_string(), "open".to_string()),
            CatalogAsset {
                category: "sleeve".to_string(),
                slug: "open".to_string(),
                label: "Renamed".to_string(),
                image: Some(b"\x89PNG\r\n\x1a\nbytes".to_vec()),
                image_mime: "image/png".to_string(),
            },
        )]);
        let mut order = services_order();
        order.sleeve = Some("open".to_string());

        let chips = order_designs(&order, &catalog);
        assert_eq!(chips.len(), 1);
        assert_eq!(chips[0].label, "Renamed");
        let image = chips[0].image.as_deref().unwrap();
        assert!(image.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn blank_values_produce_no_chips_and_blank_notes_produce_no_note() {
        let mut order = services_order();
        order.thobe_type = Some("   ".to_string());
        order.more_details = Some("  ".to_string());

        assert!(order_designs(&order, &empty_catalog()).is_empty());
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
        order.sleeve = Some("open".to_string());

        let value = serde_json::to_value(order_designs(&order, &empty_catalog())).unwrap();
        assert_eq!(value[0]["titleAr"], "الكم");
        assert_eq!(value[0]["titleEn"], "Sleeve");
        assert_eq!(value[0]["label"], "Open");
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
        // Thobe type prints as text above the diagram.
        assert!(html.contains("Thobx"));
        // ...while legacy values print as text-only chips rather than
        // disappearing.
        assert!(html.contains("Saudi"));
        assert!(html.contains("double stitching"));
        // The first order note is directly above its measurement diagram.
        let svg_start = html.find("<svg ").unwrap();
        let note = html.find("double stitching").unwrap();
        assert!(note < svg_start);
        assert!(!html.contains("alt=\"Thobx\""));
    }

    #[test]
    fn first_order_designs_sit_beside_the_sheet_and_thobe_type_is_text_only() {
        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());
        order.collar = Some("Saudi".to_string());
        order.sleeve = Some("open".to_string());
        order.f_pocket = Some("round".to_string());
        order.s_pocket = Some("with button".to_string());
        order.patti = Some("normal".to_string());
        order.emd = Some("6".to_string());
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());

        assert_eq!(html.matches("<div class=\"design-cell\">").count(), 6);
        assert!(html.contains("<span class=\"thobe-type-label\">Thobe type</span>"));
        assert!(html.contains("<strong class=\"thobe-type-name\" dir=\"auto\">Thobx</strong>"));
        assert!(html.find("with button").unwrap() < html.find("<svg ").unwrap());
    }

    #[test]
    fn designs_render_an_image_or_text_without_a_duplicate_caption() {
        let mut order = services_order();
        order.collar = Some("3".into());
        order.emd = Some("Custom <EMD>".into());
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = test_render(&detail, &branding());
        let cells: Vec<_> = html.split("<div class=\"design-cell\">").skip(1).collect();
        assert!(cells[0].contains("<img "));
        assert!(!cells[0].contains("class=\"design-name\""));
        assert!(cells[1].contains("Custom &lt;EMD&gt;"));
        assert!(!cells[1].contains("<img"));
    }

    #[test]
    fn shared_measurements_produce_one_diagram_with_all_order_rows() {
        let first = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let mut second = first.clone();
        second.order.id = uuid::Uuid::new_v4();
        second.order.order_number = 13;
        second.order.material_sku = Some("LIN-002".into());
        second.order.material_amount = 4.0;
        second.order.emd = Some("6".into());
        second.order.more_details = Some("Second order only".into());
        let html = render_document(
            &[first, second],
            &branding(),
            &empty_catalog(),
            chrono_tz::Asia::Bahrain,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap()),
        )
        .unwrap();
        assert_eq!(html.matches("<svg ").count(), 1);
        assert_eq!(html.matches("class=\"order-row\"").count(), 2);
        let rows: Vec<_> = html.split("<article class=\"order-row\"").skip(1).collect();
        assert!(rows[0].contains("ORD-12"));
        assert!(rows[0].contains("CTN-001"));
        assert!(!rows[0].contains("LIN-002"));
        assert!(!rows[0].contains("Second order only"));
        assert!(rows[1].contains("ORD-13"));
        assert!(rows[1].contains("LIN-002"));
        assert!(!rows[1].contains("Quantity:"));
        assert!(rows[1].contains("Second order only"));
    }

    #[test]
    fn different_snapshots_keep_their_own_diagrams_and_orders() {
        let first = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let mut second = first.clone();
        second.order.order_number = 13;
        second.order.measurement_id = uuid::Uuid::new_v4();
        second.measurement.id = second.order.measurement_id;
        second.measurement.readable_id = "C-23-002".into();
        second.measurement.fit = Some("loose".into());
        second.measurement.front_height = Some(130.0);
        let html = render_document(
            &[first, second],
            &branding(),
            &empty_catalog(),
            chrono_tz::Asia::Bahrain,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap()),
        )
        .unwrap();
        let sheets: Vec<_> = html
            .split("<main class=\"production-sheet\">")
            .skip(1)
            .collect();
        assert_eq!(sheets.len(), 2);
        assert!(sheets[0].contains("<dd>medium</dd>"));
        assert!(sheets[0].contains(">120</text>"));
        assert!(sheets[0].contains("ORD-12"));
        assert!(!sheets[0].contains("ORD-13"));
        assert!(sheets[1].contains("<dd>loose</dd>"));
        assert!(sheets[1].contains(">130</text>"));
        assert!(sheets[1].contains("ORD-13"));
    }

    #[sqlx::test]
    async fn document_loads_all_customer_orders_only_from_the_selected_invoice(db: sqlx::PgPool) {
        let (invoice, orders, _, _) = crate::test_support::invoice(&db, 4, false).await;
        let promised_date = chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap();
        sqlx::query("UPDATE invoices SET target_date = $1 WHERE id = $2")
            .bind(promised_date)
            .bind(invoice)
            .execute(&db)
            .await
            .unwrap();
        let state = crate::test_support::state(db.clone(), None, None).await;
        let selected = service::get_order(&state, orders[0]).await.unwrap();

        // A different snapshot for the same customer still belongs in the
        // export, but must use a separate diagram.
        let another_snapshot: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO measurements(customer_id, fit) VALUES($1, 'loose') RETURNING id",
        )
        .bind(selected.measurement.customer_id)
        .fetch_one(&db)
        .await
        .unwrap();
        sqlx::query("UPDATE orders SET measurement_id = $1 WHERE id = $2")
            .bind(another_snapshot)
            .bind(orders[2])
            .execute(&db)
            .await
            .unwrap();

        // A second customer can appear on the same invoice. A shared contact
        // number must not cause their orders to be grouped together.
        let other_customer: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO customers(name, mobile_no) VALUES('Second Customer', '33112233') RETURNING id",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        let other_snapshot: uuid::Uuid =
            sqlx::query_scalar("INSERT INTO measurements(customer_id) VALUES($1) RETURNING id")
                .bind(other_customer)
                .fetch_one(&db)
                .await
                .unwrap();
        sqlx::query("UPDATE orders SET measurement_id = $1 WHERE id = $2")
            .bind(other_snapshot)
            .bind(orders[3])
            .execute(&db)
            .await
            .unwrap();

        // A previous invoice for this customer must not enter today's sheet.
        let previous_invoice: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO invoices(branch_id,total_price,vat_rate,taxable_amount,vat_amount)
             SELECT branch_id,total_price,vat_rate,taxable_amount,vat_amount
             FROM invoices WHERE id = $1 RETURNING id",
        )
        .bind(invoice)
        .fetch_one(&db)
        .await
        .unwrap();
        let previous_order: uuid::Uuid = sqlx::query_scalar(
            "INSERT INTO orders(invoice_id,measurement_id,material_source,
                                customer_material_description,material_amount,price)
             VALUES($1,$2,'customer','Previous cotton',3,100) RETURNING id",
        )
        .bind(previous_invoice)
        .bind(selected.measurement.id)
        .fetch_one(&db)
        .await
        .unwrap();

        let (details, saved_target_date) = service::order_document_details(&state, orders[0])
            .await
            .unwrap();
        assert_eq!(details.len(), 3);
        assert_eq!(saved_target_date, Some(promised_date));
        assert!(details
            .iter()
            .all(|detail| detail.order.invoice_id == invoice));
        assert!(details
            .iter()
            .all(|detail| { detail.measurement.customer_id == selected.measurement.customer_id }));
        assert!(details
            .windows(2)
            .all(|pair| { pair[0].order.order_number < pair[1].order.order_number }));
        let html = render_order_document(&state, orders[0]).await.unwrap();
        assert!(html.contains("<strong dir=\"ltr\">06-08-2026</strong>"));
        assert!(!html.contains("Quantity:"));
        assert!(!html.contains("Made at:"));
        assert!(!html.contains("Collection:"));
        assert_eq!(html.matches("class=\"order-row\"").count(), 3);
        assert_eq!(html.matches("<svg ").count(), 2);
        for id in &orders[..3] {
            assert!(html.contains(&format!("data-order-id=\"{id}\"")));
        }
        for id in [orders[3], previous_order] {
            assert!(!html.contains(&format!("data-order-id=\"{id}\"")));
        }
        sqlx::query("UPDATE invoices SET target_date = NULL WHERE id = $1")
            .bind(invoice)
            .execute(&db)
            .await
            .unwrap();
        let unscheduled = render_order_document(&state, orders[0]).await.unwrap();
        assert!(unscheduled.contains("<strong dir=\"ltr\">Not set</strong>"));
    }

    #[test]
    fn a_missing_target_date_is_explicit_instead_of_using_another_date() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let html = render_document(
            &[detail],
            &branding(),
            &empty_catalog(),
            chrono_tz::Asia::Bahrain,
            None,
        )
        .unwrap();
        assert!(html.contains("<strong dir=\"ltr\">Not set</strong>"));
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
        outcome: "active".into(),
        closure_reason: None,
        closed_at: None,
        closed_by: None,
        credit_amount: None,
        retained_charge: 0.0,
        restored_material_quantity: 0.0,
        id: uuid::Uuid::nil(),
        order_number: 12,
        invoice_id: uuid::Uuid::nil(),
        invoice_number: 7,
        invoice_date: chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2026, 7, 30, 9, 30, 0)
            .unwrap(),
        measurement_id: uuid::Uuid::nil(),
        customer_name: "Ahmed".to_string(),
        customer_number: 23,
        customer_mobile: "+973 0000".to_string(),
        material: "Cotton".to_string(),
        material_source: "shop".to_string(),
        material_sku: Some("CTN-001".to_string()),
        material_amount: 3.5,
        price: 100.0,
        is_urgent: false,
        urgent_charge: 0.0,
        status: "pending".to_string(),
        collected_at: None,
        ready_at: None,
        ready_by: None,
        thobe_type: None,
        f_pocket: None,
        s_pocket: None,
        collar: None,
        sleeve: None,
        patti: None,
        emd: None,
        more_details: None,
        production_location_id: None,
        production_location: None,
        production_location_inferred: false,
        material_location_id: None,
        material_location: None,
        receiving_location_id: None,
        collection_method: "pickup".into(),
        customer_address: None,
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
            readable_id: "C-23-001".into(),
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

#[cfg(test)]
mod customer_address_tests {
    use crate::test_support;
    use sqlx::PgPool;
    use uuid::Uuid;
    #[sqlx::test]
    async fn delivery_orders_and_documents_use_each_customers_saved_address(pool: PgPool) {
        let (invoice, orders, _, _) = test_support::invoice(&pool, 2, false).await;
        sqlx::query("UPDATE invoices SET collection_method='delivery',branch_id=NULL WHERE id=$1")
            .bind(invoice)
            .execute(&pool)
            .await
            .unwrap();
        let other_customer: Uuid = sqlx::query_scalar("INSERT INTO customers(name,mobile_no,address) VALUES('Other recipient','33556677','Other customer address') RETURNING id").fetch_one(&pool).await.unwrap();
        let other_measurement: Uuid =
            sqlx::query_scalar("INSERT INTO measurements(customer_id) VALUES($1) RETURNING id")
                .bind(other_customer)
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("UPDATE customers c SET address='Building 2 <Road 3>' FROM measurements m JOIN orders o ON o.measurement_id=m.id WHERE c.id=m.customer_id AND o.id=$1").bind(orders[0]).execute(&pool).await.unwrap();
        sqlx::query("UPDATE orders SET measurement_id=$2 WHERE id=$1")
            .bind(orders[1])
            .bind(other_measurement)
            .execute(&pool)
            .await
            .unwrap();
        let state = test_support::state(pool.clone(), None, None).await;
        for (order_id, address, escaped) in [
            (
                orders[0],
                "Building 2 <Road 3>",
                "Building 2 &lt;Road 3&gt;",
            ),
            (
                orders[1],
                "Other customer address",
                "Other customer address",
            ),
        ] {
            let detail = crate::features::orders::service::get_order(&state, order_id)
                .await
                .unwrap();
            assert_eq!(detail.order.customer_address.as_deref(), Some(address));
            assert!(detail.order.receiving_location_id.is_none());
            let html = crate::features::orders::document::render_order_document(&state, order_id)
                .await
                .unwrap();
            assert!(html.contains(escaped));
        }
        let html = crate::features::invoices::document::render_invoice_document(&state, invoice)
            .await
            .unwrap();
        assert!(html.contains("Building 2 &lt;Road 3&gt;"));
        assert!(html.contains("Other customer address"));
    }
}
