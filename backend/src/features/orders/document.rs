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

    let fields = thob_fields();
    let measurement = formatted_measurement(&detail);

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
        // The thob diagram is the same story: garment, markers, view field
        // lists and the laid-out captions are all computed here, so a redesign
        // can't change how a measurement is written out or overlap two labels.
        thob_garment => minijinja::Value::from_serialize(thob_garment()),
        thob_markers => minijinja::Value::from_serialize(thob_markers_map(&fields)),
        thob_front_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Front, &measurement)),
        thob_back_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Back, &measurement)),
        thob_front_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Front, &measurement)),
        thob_back_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Back, &measurement)),
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
/// field name (the same keys `measurement_labels` uses in the template). Only
/// fields the snapshot actually captured appear — the diagram's captions are
/// read from this map, so an unrecorded field gets no value on the paper.
fn formatted_measurement(detail: &OrderDetail) -> BTreeMap<String, String> {
    let m = &detail.measurement;
    let mut values = BTreeMap::new();

    push_number(&mut values, "lengthFl", m.length_fl);
    push_number(&mut values, "lengthBl", m.length_bl);
    push_number(&mut values, "shoulder", m.shoulder);
    push_number(&mut values, "shoulderDown", m.shoulder_down);
    push_number(&mut values, "chest", m.chest);
    push_number(&mut values, "chestUp", m.chest_up);
    push_number(&mut values, "waist", m.waist);
    push_number(&mut values, "hips", m.hips);
    push_number(&mut values, "sleeveLength", m.sleeve_length);
    push_number(&mut values, "neck", m.neck);
    push_number(&mut values, "neckWidth", m.neck_width);
    push_number(&mut values, "openHand", m.open_hand);
    push_number(&mut values, "openHandFolding", m.open_hand_folding);
    push_number(&mut values, "cuffWidth", m.cuff_width);
    push_number(&mut values, "cuffling", m.cuffling);
    push_number(&mut values, "armHole", m.arm_hole);
    push_number(&mut values, "foWidth", m.fo_width);
    push_number(&mut values, "fo", m.fo);
    push_number(&mut values, "bottom", m.bottom);
    push_number(&mut values, "bottomFolding", m.bottom_folding);
    push_number(&mut values, "fullBody", m.full_body);
    push_number(&mut values, "sleeveHalf", m.sleeve_half);
    push_number(&mut values, "button", m.button);
    push_number(&mut values, "buttonFold", m.button_fold);
    push_number(&mut values, "openFold", m.open_fold);
    push_number(&mut values, "frontPocketLength", m.front_pocket_length);

    push_text(
        &mut values,
        "frontPocketLengthByWidth",
        &m.front_pocket_length_by_width,
    );
    push_number(&mut values, "sidePocketLength", m.side_pocket_length);
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

    values
}

// ---------------------------------------------------------------------------
// The thob measurement diagram.
//
// Both the frontend (`thob-diagram.tsx` / `thob-sketch.ts` / `measurement-fields.ts`)
// and this document draw the garment from a file-for-file identical geometry
// and field split: 20 measurements on the front view, 10 on the back. Change a
// marker here and the same edit must land in the frontend, or the printed
// arrows and the screen arrows will disagree. The caption layout is mirrored
// from `layoutCaptions` in `thob-diagram.tsx` — captions are placed
// absolutely, so a collision here would be invisible on the screen version.

const THOB_W: f64 = 480.0;
const THOB_H: f64 = 500.0;
const CAPTION_H: f64 = 20.0;
const CAPTION_GAP: f64 = 2.0;
const CAPTION_PAD: f64 = 1.0;
/// Must match `MEASUREMENT_UNIT` in `measurement-fields.ts`.
const THOB_UNIT: &str = "inch";

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
enum ThobView {
    Front,
    Back,
}

#[derive(Serialize, Clone)]
struct ThobPoint {
    cx: f64,
    cy: f64,
}

#[derive(Serialize, Clone)]
struct ThobSegment {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
}

#[derive(Serialize, Clone)]
struct ThobMarker {
    dims: Vec<ThobSegment>,
    guides: Vec<ThobSegment>,
    shapes: Vec<&'static str>,
    dots: Vec<ThobPoint>,
    label: ThobPoint,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThobGarment {
    outline: &'static str,
    collar: &'static str,
    placket: &'static str,
    chest_pocket: &'static str,
    mobile_pocket: &'static str,
    side_pockets: &'static str,
    cuffs: &'static str,
    center_back_seam: &'static str,
    buttons: Vec<ThobPoint>,
    sleeve_buttons: Vec<ThobPoint>,
}

#[derive(Serialize)]
struct ThobCaption {
    x: f64,
    y: f64,
    w: f64,
    text: String,
}

struct FieldDef {
    name: &'static str,
    diagram_label: &'static str,
    numeric: bool,
    view: ThobView,
    marker: ThobMarker,
}

const THOB_OUTLINE: &str = "M 258 46 C 272 47 286 50 300 60 L 354 252 L 324 268 L 290 146 L 314 430 Q 240 446 166 430 L 190 146 L 156 268 L 126 252 L 180 60 C 194 50 208 47 222 46 Q 240 78 258 46 Z";
const THOB_COLLAR: &str = "M 222 46 C 240 78 258 50 258 46";
const THOB_PLACKET: &str = "M 234 61 L 234 200 M 246 61 L 246 200 M 234 200 L 246 200";
const THOB_CHEST_POCKET: &str = "M 197 116 L 225 116 L 225 158 L 197 158 Z";
const THOB_MOBILE_POCKET: &str = "M 260 200 L 288 200 L 288 246 L 260 246 Z";
const THOB_SIDE_POCKETS: &str = "M 182 240 L 178 290 M 298 240 L 302 290";
const THOB_CUFFS: &str = "M 133 227 L 163 243 M 347 227 L 317 243";
const THOB_CENTER_BACK_SEAM: &str = "M 240 46 L 240 430";

fn point(x: f64, y: f64) -> ThobPoint {
    ThobPoint { cx: x, cy: y }
}

fn segment(x1: f64, y1: f64, x2: f64, y2: f64) -> ThobSegment {
    ThobSegment { x1, y1, x2, y2 }
}

fn marker(label: (f64, f64)) -> ThobMarker {
    ThobMarker {
        dims: Vec::new(),
        guides: Vec::new(),
        shapes: Vec::new(),
        dots: Vec::new(),
        label: point(label.0, label.1),
    }
}

fn field(
    name: &'static str,
    diagram_label: &'static str,
    numeric: bool,
    view: ThobView,
    marker: ThobMarker,
) -> FieldDef {
    FieldDef {
        name,
        diagram_label,
        numeric,
        view,
        marker,
    }
}

/// All 30 measurements, in the same order and with the same geometry as
/// `MEASUREMENT_FIELDS` on the frontend.
fn thob_fields() -> Vec<FieldDef> {
    let mut length_fl = marker((60.0, 238.0));
    length_fl.dims = vec![segment(60.0, 46.0, 60.0, 430.0)];
    length_fl.guides = vec![
        segment(64.0, 46.0, 220.0, 46.0),
        segment(64.0, 430.0, 168.0, 430.0),
    ];

    let mut length_bl = marker((420.0, 238.0));
    length_bl.dims = vec![segment(420.0, 46.0, 420.0, 430.0)];
    length_bl.guides = vec![
        segment(416.0, 46.0, 260.0, 46.0),
        segment(416.0, 430.0, 312.0, 430.0),
    ];

    let mut shoulder = marker((240.0, 14.0));
    shoulder.dims = vec![segment(180.0, 30.0, 300.0, 30.0)];
    shoulder.guides = vec![
        segment(180.0, 58.0, 180.0, 26.0),
        segment(300.0, 58.0, 300.0, 26.0),
    ];

    // How far the shoulder slopes down from the neck — drawn as a short
    // vertical drop at the shoulder point, next to the shoulder width arrow.
    let mut shoulder_down = marker((348.0, 70.0));
    shoulder_down.dims = vec![segment(300.0, 60.0, 300.0, 80.0)];
    shoulder_down.guides = vec![segment(300.0, 70.0, 330.0, 70.0)];

    let mut chest = marker((240.0, 150.0));
    chest.dims = vec![segment(190.0, 150.0, 290.0, 150.0)];

    let mut chest_up = marker((240.0, 112.0));
    chest_up.dims = vec![segment(186.0, 112.0, 294.0, 112.0)];

    let mut waist = marker((240.0, 250.0));
    waist.dims = vec![segment(181.0, 250.0, 299.0, 250.0)];

    let mut hips = marker((240.0, 320.0));
    hips.dims = vec![segment(175.0, 320.0, 305.0, 320.0)];

    let mut neck = marker((356.0, 24.0));
    neck.shapes = vec![THOB_COLLAR];
    neck.guides = vec![segment(240.0, 64.0, 330.0, 28.0)];

    let mut neck_width = marker((240.0, 14.0));
    neck_width.dims = vec![segment(222.0, 34.0, 258.0, 34.0)];
    neck_width.guides = vec![
        segment(222.0, 48.0, 222.0, 30.0),
        segment(258.0, 48.0, 258.0, 30.0),
    ];

    let mut arm_hole = marker((212.0, 101.0));
    arm_hole.dims = vec![segment(182.0, 65.0, 190.0, 144.0)];

    let mut sleeve_length = marker((370.0, 140.0));
    sleeve_length.dims = vec![segment(317.0, 55.0, 371.0, 247.0)];

    // The half-sleeve measure runs inside the sleeve, parallel to its length.
    let mut sleeve_half = marker((288.0, 158.0));
    sleeve_half.dims = vec![segment(308.0, 85.0, 352.0, 232.0)];
    sleeve_half.guides = vec![segment(330.0, 158.0, 306.0, 158.0)];

    let mut open_hand = marker((128.0, 306.0));
    open_hand.dims = vec![segment(119.0, 266.0, 149.0, 282.0)];
    open_hand.guides = vec![segment(134.0, 275.0, 130.0, 296.0)];

    // The fold at the cuff opening — a short arrow across the cuff band,
    // just above the open-hand marker.
    let mut open_hand_folding = marker((100.0, 252.0));
    open_hand_folding.dims = vec![segment(126.0, 238.0, 152.0, 251.0)];
    open_hand_folding.guides = vec![segment(139.0, 244.0, 116.0, 250.0)];

    let mut cuff_width = marker((78.0, 212.0));
    cuff_width.shapes = vec![THOB_CUFFS];

    // The cuffling runs along the left cuff band, just below the cuff-width
    // callout it belongs to.
    let mut cuffling = marker((96.0, 232.0));
    cuffling.dims = vec![segment(133.0, 227.0, 163.0, 243.0)];

    let mut front_pocket_length = marker((110.0, 180.0));
    front_pocket_length.dims = vec![segment(180.0, 116.0, 180.0, 158.0)];
    front_pocket_length.guides = vec![
        segment(197.0, 116.0, 180.0, 116.0),
        segment(197.0, 158.0, 180.0, 158.0),
        segment(180.0, 150.0, 130.0, 172.0),
    ];
    front_pocket_length.shapes = vec![THOB_CHEST_POCKET];

    let mut front_pocket_length_by_width = marker((108.0, 88.0));
    front_pocket_length_by_width.shapes = vec![THOB_CHEST_POCKET];
    front_pocket_length_by_width.guides = vec![segment(197.0, 120.0, 140.0, 96.0)];

    // The side pocket's length runs down the left side seam, mirroring the
    // front pocket's length arrow on the chest pocket.
    let mut side_pocket_length = marker((108.0, 265.0));
    side_pocket_length.dims = vec![segment(176.0, 240.0, 176.0, 290.0)];
    side_pocket_length.guides = vec![segment(176.0, 265.0, 140.0, 265.0)];

    // The length-by-width, called out on the seam like the front pocket's.
    let mut side_pocket_length_by_width = marker((110.0, 308.0));
    side_pocket_length_by_width.shapes = vec![THOB_SIDE_POCKETS];
    side_pocket_length_by_width.guides = vec![segment(178.0, 280.0, 140.0, 300.0)];

    let mut mobile_pocket_length_by_width = marker((380.0, 222.0));
    mobile_pocket_length_by_width.shapes = vec![THOB_MOBILE_POCKET];
    mobile_pocket_length_by_width.guides = vec![segment(288.0, 222.0, 326.0, 222.0)];

    let mut fo_width = marker((130.0, 230.0));
    fo_width.dims = vec![segment(234.0, 192.0, 246.0, 192.0)];
    fo_width.guides = vec![segment(240.0, 196.0, 166.0, 224.0)];

    // Fo sits just above its width on the placket, sharing the same leader
    // direction so the two captions stack without overlapping.
    let mut fo = marker((130.0, 204.0));
    fo.dims = vec![segment(234.0, 168.0, 246.0, 168.0)];
    fo.guides = vec![segment(240.0, 172.0, 166.0, 198.0)];

    // Hem width across the bottom of the thob.
    let mut bottom = marker((240.0, 460.0));
    bottom.dims = vec![segment(166.0, 430.0, 314.0, 430.0)];
    bottom.guides = vec![segment(240.0, 430.0, 240.0, 450.0)];

    // The hem fold depth — a short vertical arrow at the right hem corner,
    // under the hem width arrow.
    let mut bottom_folding = marker((384.0, 419.0));
    bottom_folding.dims = vec![segment(314.0, 408.0, 314.0, 430.0)];
    bottom_folding.guides = vec![segment(314.0, 419.0, 352.0, 419.0)];

    // The button stand runs down the placket, with its fold as a short
    // arrow at the foot of the stand.
    let mut button = marker((308.0, 141.0));
    button.dims = vec![segment(258.0, 96.0, 258.0, 186.0)];
    button.guides = vec![segment(258.0, 141.0, 290.0, 141.0)];

    let mut button_fold = marker((310.0, 197.0));
    button_fold.dims = vec![segment(258.0, 190.0, 258.0, 204.0)];
    button_fold.guides = vec![segment(258.0, 197.0, 292.0, 197.0)];

    // The open fold sits low on the front panel, clear of the hem arrows.
    let mut open_fold = marker((140.0, 407.0));
    open_fold.dims = vec![segment(200.0, 400.0, 200.0, 414.0)];
    open_fold.guides = vec![segment(200.0, 407.0, 160.0, 407.0)];

    // Full body: the shoulder-to-hem run on the right of the garment, kept
    // clear of the left-side front-length arrow.
    let mut full_body = marker((332.0, 238.0));
    full_body.dims = vec![segment(332.0, 46.0, 332.0, 430.0)];
    full_body.guides = vec![
        segment(328.0, 46.0, 300.0, 46.0),
        segment(328.0, 430.0, 314.0, 430.0),
    ];

    vec![
        field("lengthFl", "Front Length", true, ThobView::Front, length_fl),
        field("lengthBl", "Back Length", true, ThobView::Back, length_bl),
        field("shoulder", "Shoulder", true, ThobView::Front, shoulder),
        field(
            "shoulderDown",
            "Shoulder Down",
            true,
            ThobView::Front,
            shoulder_down,
        ),
        field("chest", "Chest", true, ThobView::Front, chest),
        field("chestUp", "Chest Up", true, ThobView::Front, chest_up),
        field("waist", "Waist", true, ThobView::Front, waist),
        field("hips", "Hips", true, ThobView::Front, hips),
        field("neck", "Neck", true, ThobView::Back, neck),
        field("neckWidth", "Neck W", true, ThobView::Back, neck_width),
        field("armHole", "Armhole", true, ThobView::Back, arm_hole),
        field(
            "sleeveLength",
            "Sleeve",
            true,
            ThobView::Back,
            sleeve_length,
        ),
        field(
            "sleeveHalf",
            "Sleeve Half",
            true,
            ThobView::Back,
            sleeve_half,
        ),
        field("openHand", "Open Hand", true, ThobView::Back, open_hand),
        field(
            "openHandFolding",
            "Open Hand Folding",
            true,
            ThobView::Back,
            open_hand_folding,
        ),
        field("cuffWidth", "Cuff W", true, ThobView::Back, cuff_width),
        field("cuffling", "Cuffling", true, ThobView::Back, cuffling),
        field(
            "frontPocketLength",
            "Front Pocket",
            true,
            ThobView::Front,
            front_pocket_length,
        ),
        field(
            "frontPocketLengthByWidth",
            "Pocket L×W",
            false,
            ThobView::Front,
            front_pocket_length_by_width,
        ),
        field(
            "sidePocketLength",
            "Side Pocket",
            true,
            ThobView::Front,
            side_pocket_length,
        ),
        field(
            "sidePocketLengthByWidth",
            "Side L×W",
            false,
            ThobView::Front,
            side_pocket_length_by_width,
        ),
        field(
            "mobilePocketLengthByWidth",
            "Mobile Pocket",
            false,
            ThobView::Front,
            mobile_pocket_length_by_width,
        ),
        field("foWidth", "Fo Width", true, ThobView::Front, fo_width),
        field("fo", "Fo", true, ThobView::Front, fo),
        field("button", "Button", true, ThobView::Front, button),
        field(
            "buttonFold",
            "Button Fold",
            true,
            ThobView::Front,
            button_fold,
        ),
        field("openFold", "Open Fold", true, ThobView::Front, open_fold),
        field("bottom", "Bottom", true, ThobView::Front, bottom),
        field(
            "bottomFolding",
            "Bottom Folding",
            true,
            ThobView::Front,
            bottom_folding,
        ),
        field("fullBody", "Full Body", true, ThobView::Front, full_body),
    ]
}

fn thob_garment() -> ThobGarment {
    ThobGarment {
        outline: THOB_OUTLINE,
        collar: THOB_COLLAR,
        placket: THOB_PLACKET,
        chest_pocket: THOB_CHEST_POCKET,
        mobile_pocket: THOB_MOBILE_POCKET,
        side_pockets: THOB_SIDE_POCKETS,
        cuffs: THOB_CUFFS,
        center_back_seam: THOB_CENTER_BACK_SEAM,
        buttons: vec![
            point(240.0, 96.0),
            point(240.0, 126.0),
            point(240.0, 156.0),
            point(240.0, 186.0),
        ],
        sleeve_buttons: vec![point(153.0, 253.0), point(327.0, 253.0)],
    }
}

fn thob_markers_map(fields: &[FieldDef]) -> BTreeMap<&'static str, ThobMarker> {
    fields.iter().map(|f| (f.name, f.marker.clone())).collect()
}

fn thob_field_names(
    fields: &[FieldDef],
    view: ThobView,
    values: &BTreeMap<String, String>,
) -> Vec<&'static str> {
    fields
        .iter()
        .filter(|f| f.view == view && values.contains_key(f.name))
        .map(|f| f.name)
        .collect()
}

fn clamp_value(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

fn caption_width(text: &str) -> f64 {
    (text.chars().count() as f64 * 5.0 + 10.0).max(44.0)
}

/// Two rects collide when they touch or come within `CAPTION_GAP` of each
/// other — the same check `rectsOverlap` performs in `thob-diagram.tsx`.
fn rects_touch(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 + a.2 + CAPTION_GAP > b.0
        && b.0 + b.2 + CAPTION_GAP > a.0
        && a.1 + a.3 + CAPTION_GAP > b.1
        && b.1 + b.3 + CAPTION_GAP > a.1
}

/// The caption a field gets on the diagram: a recorded value rides the short
/// label, a numeric one carries the unit. `thob_captions` only lays out
/// recorded fields, so `def.diagram_label` alone never reaches the paper —
/// an unrecorded measurement contributes nothing to the silhouette. Same rule
/// as `diagramCaption` in `thob-diagram.tsx`.
fn caption_text(def: &FieldDef, values: &BTreeMap<String, String>) -> String {
    if let Some(value) = values.get(def.name) {
        if def.numeric {
            format!("{value} {THOB_UNIT} · {}", def.diagram_label)
        } else {
            format!("{value} · {}", def.diagram_label)
        }
    } else {
        def.diagram_label.to_string()
    }
}

/// Places one caption per recorded field for a view, nudging each box
/// vertically until none overlaps another. Fields the measurement snapshot
/// didn't capture are skipped entirely — only what was recorded is drawn on
/// the silhouette, so an unpopulated field never gets a box or an arrow.
/// Mirrors `layoutCaptions` in `thob-diagram.tsx` exactly, so the printed and
/// on-screen diagrams agree.
fn thob_captions(
    fields: &[FieldDef],
    view: ThobView,
    values: &BTreeMap<String, String>,
) -> BTreeMap<String, ThobCaption> {
    let mut sorted: Vec<&FieldDef> = fields
        .iter()
        .filter(|f| f.view == view && values.contains_key(f.name))
        .collect();
    sorted.sort_by_key(|f| {
        (
            (f.marker.label.cy * 1000.0) as i64,
            (f.marker.label.cx * 1000.0) as i64,
        )
    });

    let mut placed: Vec<(f64, f64, f64, f64)> = Vec::new();
    let mut captions: BTreeMap<String, ThobCaption> = BTreeMap::new();

    for def in sorted {
        let text = caption_text(def, values);
        let w = caption_width(&text);
        let x = clamp_value(
            def.marker.label.cx - w / 2.0,
            CAPTION_PAD,
            THOB_W - w - CAPTION_PAD,
        );
        let base_y = clamp_value(
            def.marker.label.cy - CAPTION_H / 2.0,
            CAPTION_PAD,
            THOB_H - CAPTION_H - CAPTION_PAD,
        );
        let slot = CAPTION_H + CAPTION_GAP;

        let mut chosen_y = base_y;
        for step in 0..9i64 {
            let target = if step == 0 {
                base_y
            } else if step % 2 == 1 {
                base_y + ((step + 1) as f64 / 2.0) * slot
            } else {
                base_y - (step as f64 / 2.0) * slot
            };
            let candidate = clamp_value(target, CAPTION_PAD, THOB_H - CAPTION_H - CAPTION_PAD);
            let rect = (x, candidate, w, CAPTION_H);
            if !placed.iter().any(|r| rects_touch(*r, rect)) {
                chosen_y = candidate;
                break;
            }
            chosen_y = candidate;
        }

        placed.push((x, chosen_y, w, CAPTION_H));
        captions.insert(
            def.name.to_string(),
            ThobCaption {
                x,
                y: chosen_y,
                w,
                text,
            },
        );
    }

    captions
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
    fn measurements_are_formatted_for_the_diagram_captions() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };

        let values = formatted_measurement(&detail);
        assert_eq!(values["lengthFl"], "120");
        assert_eq!(values["chest"], "50");
        assert_eq!(values["sleeveLength"], "60");
        // Everything the fixture didn't capture stays out of the captions.
        assert!(!values.contains_key("waist"));
        assert!(!values.contains_key("lengthBl"));
    }

    #[test]
    fn the_template_renders_with_front_and_back_thob_diagrams() {
        let env = environment(&branding()).unwrap();
        let template = env.get_template(TEMPLATE_NAME).unwrap();

        let mut measurement = tests_support::measurement();
        measurement.length_bl = Some(124.0);
        measurement.waist = Some(38.5);
        measurement.front_pocket_length_by_width = Some("No 16x14".to_string());
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement,
        };
        let fields = thob_fields();
        let measurement = formatted_measurement(&detail);
        let html = template
            .render(context! {
                order => minijinja::Value::from_serialize(&detail),
                company => minijinja::Value::from_serialize(branding()),
                currency => CURRENCY,
                amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
                designs => minijinja::Value::from_serialize(order_designs(&detail.order)),
                design_note => minijinja::Value::from_serialize(design_note(&detail.order)),
                thob_garment => minijinja::Value::from_serialize(thob_garment()),
                thob_markers => minijinja::Value::from_serialize(thob_markers_map(&fields)),
                thob_front_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Front, &measurement)),
                thob_back_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Back, &measurement)),
                thob_front_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Front, &measurement)),
                thob_back_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Back, &measurement)),
            })
            .unwrap();

        // The template is the only smoke seat: it runs the thob_callout macro
        // against every field, so a malformed marker map fails right here.
        assert!(html.contains("واجهة الثوب"));
        assert!(html.contains("خلف الثوب"));
        // The document is titled by the order's own readable number, not an
        // id prefix.
        assert!(html.contains("ORD-12"));
        // The material prints as its SKU, not its name.
        assert!(html.contains("CTN-001"));
        assert!(!html.contains("Cotton"));
        // Recorded numeric values ride the captions, whole numbers trimmed,
        // each with its short diagram label.
        assert!(html.contains("120 inch · Front Length"));
        assert!(html.contains("124 inch · Back Length"));
        assert!(html.contains("60 inch · Sleeve"));
        assert!(html.contains("38.5 inch · Waist"));
        // Text values are already self-describing — no "inch".
        assert!(!html.contains("No inch"));
        // Unrecorded fields are omitted from the diagram: no caption box, no
        // arrow, no stray label on the silhouette.
        assert!(!html.contains("Front Pocket"));
        assert!(!html.contains("Fo Width"));
        // Exactly the six recorded fields are called out: 4 on the front
        // view (lengthFl, chest, waist, frontPocketLengthByWidth)
        // and 2 on the back (lengthBl, sleeveLength).
        assert_eq!(html.matches("thob-callout").count(), 6);
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
        let env = environment(&branding()).unwrap();
        let template = env.get_template(TEMPLATE_NAME).unwrap();

        let mut order = services_order();
        order.thobe_type = Some("thobx".to_string());
        order.collar = Some("Saudi".to_string());
        order.more_details = Some("double stitching".to_string());
        let detail = OrderDetail {
            order,
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let fields = thob_fields();
        let measurement = formatted_measurement(&detail);
        let html = template
            .render(context! {
                order => minijinja::Value::from_serialize(&detail),
                company => minijinja::Value::from_serialize(branding()),
                currency => CURRENCY,
                amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
                designs => minijinja::Value::from_serialize(order_designs(&detail.order)),
                design_note => minijinja::Value::from_serialize(design_note(&detail.order)),
                thob_garment => minijinja::Value::from_serialize(thob_garment()),
                thob_markers => minijinja::Value::from_serialize(thob_markers_map(&fields)),
                thob_front_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Front, &measurement)),
                thob_back_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Back, &measurement)),
                thob_front_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Front, &measurement)),
                thob_back_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Back, &measurement)),
            })
            .unwrap();

        // Each chip names its slot in both languages, so the image is
        // identifiable even when the stored value itself is cryptic ("3").
        assert!(html.contains("Thobe"));
        assert!(html.contains("الياقة"));
        assert!(html.contains("Collar"));
        // Catalog matches print their display label with the raster...
        assert!(html.contains("Thobx"));
        // ...while legacy values print as text-only chips rather than
        // disappearing.
        assert!(html.contains("Saudi"));
        assert!(html.contains("double stitching"));
    }

    #[test]
    fn diagram_captions_stay_in_bounds_and_never_overlap() {
        let detail = OrderDetail {
            order: services_order(),
            invoice_number: 7,
            measurement: tests_support::measurement(),
        };
        let fields = thob_fields();
        let values = formatted_measurement(&detail);

        for view in [ThobView::Front, ThobView::Back] {
            let captions = thob_captions(&fields, view, &values);
            let rects: Vec<(f64, f64, f64, f64)> = captions
                .values()
                .map(|c| (c.x, c.y, c.w, CAPTION_H))
                .collect();
            for rect in &rects {
                assert!(
                    rect.0 >= 0.0 && rect.0 + rect.2 <= THOB_W,
                    "{view:?}: x out of bounds"
                );
                assert!(
                    rect.1 >= 0.0 && rect.1 + rect.3 <= THOB_H,
                    "{view:?}: y out of bounds"
                );
            }
            for (i, a) in rects.iter().enumerate() {
                for b in rects.iter().skip(i + 1) {
                    assert!(
                        !rects_touch(*a, *b),
                        "{view:?}: captions overlap at {a:?} vs {b:?}"
                    );
                }
            }
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
            length_fl: Some(120.0),
            length_bl: None,
            chest: Some(50.0),
            waist: None,
            hips: None,
            shoulder: None,
            shoulder_down: None,
            sleeve_length: Some(60.0),
            neck: None,
            open_hand: None,
            open_hand_folding: None,
            chest_up: None,
            cuff_width: None,
            cuffling: None,
            neck_width: None,
            arm_hole: None,
            fo_width: None,
            fo: None,
            bottom: None,
            bottom_folding: None,
            full_body: None,
            sleeve_half: None,
            button: None,
            button_fold: None,
            open_fold: None,
            front_pocket_length: None,
            front_pocket_length_by_width: None,
            side_pocket_length: None,
            side_pocket_length_by_width: None,
            mobile_pocket_length_by_width: None,
        }
    }
}
