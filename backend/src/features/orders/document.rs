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
    document::{format_amount, format_quantity, CURRENCY},
    error::AppError,
    state::AppState,
};

use super::{service, types::OrderDetail};

/// The copy of the template compiled into the binary, used unless
/// `INVOICE_TEMPLATE_DIR` points somewhere else (both documents live in the
/// same templates directory).
const DEFAULT_TEMPLATE: &str = include_str!("../../../templates/order.html");

const TEMPLATE_NAME: &str = "order.html";

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
        company => minijinja::Value::from_serialize(branding),
        currency => CURRENCY,
        // Amounts are pre-formatted rather than left to the template, so that
        // editing the design can't accidentally change how money is written.
        amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
        // The thob diagram is the same story: garment, markers, view field
        // lists and the laid-out captions are all computed here, so a redesign
        // can't change how a measurement is written out or overlap two labels.
        thob_garment => minijinja::Value::from_serialize(thob_garment()),
        thob_markers => minijinja::Value::from_serialize(thob_markers_map(&fields)),
        thob_front_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Front)),
        thob_back_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Back)),
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
        "advanceAmount".into(),
        format_amount(detail.order.invoice_advance_amount),
    );
    amounts.insert(
        "amountPaid".into(),
        format_amount(detail.order.invoice_amount_paid),
    );
    amounts.insert(
        "balanceDue".into(),
        format_amount(
            (detail.order.invoice_total_price - detail.order.invoice_amount_paid).max(0.0),
        ),
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
    push_number(&mut values, "chest", m.chest);
    push_number(&mut values, "chestUp", m.chest_up);
    push_number(&mut values, "waist", m.waist);
    push_number(&mut values, "hips", m.hips);
    push_number(&mut values, "sleeveLength", m.sleeve_length);
    push_number(&mut values, "neck", m.neck);
    push_number(&mut values, "neckWidth", m.neck_width);
    push_number(&mut values, "openHand", m.open_hand);
    push_number(&mut values, "cuffWidth", m.cuff_width);
    push_number(&mut values, "aramHole", m.aram_hole);
    push_number(&mut values, "foWidth", m.fo_width);
    push_number(&mut values, "frantPocketLength", m.frant_pocket_length);

    push_text(
        &mut values,
        "farntPocketLengthByWidth",
        &m.farnt_pocket_length_by_width,
    );
    push_text(&mut values, "sidePocket", &m.side_pocket);
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
// and field split: 11 measurements on the front view, 7 on the back. Change a
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

/// All 18 measurements, in the same order and with the same geometry as
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

    let mut aram_hole = marker((212.0, 101.0));
    aram_hole.dims = vec![segment(182.0, 65.0, 190.0, 144.0)];

    let mut sleeve_length = marker((370.0, 140.0));
    sleeve_length.dims = vec![segment(317.0, 55.0, 371.0, 247.0)];

    let mut open_hand = marker((128.0, 306.0));
    open_hand.dims = vec![segment(119.0, 266.0, 149.0, 282.0)];
    open_hand.guides = vec![segment(134.0, 275.0, 130.0, 296.0)];

    let mut cuff_width = marker((78.0, 212.0));
    cuff_width.shapes = vec![THOB_CUFFS];

    let mut frant_pocket_length = marker((110.0, 180.0));
    frant_pocket_length.dims = vec![segment(180.0, 116.0, 180.0, 158.0)];
    frant_pocket_length.guides = vec![
        segment(197.0, 116.0, 180.0, 116.0),
        segment(197.0, 158.0, 180.0, 158.0),
        segment(180.0, 150.0, 130.0, 172.0),
    ];
    frant_pocket_length.shapes = vec![THOB_CHEST_POCKET];

    let mut farnt_pocket_length_by_width = marker((108.0, 88.0));
    farnt_pocket_length_by_width.shapes = vec![THOB_CHEST_POCKET];
    farnt_pocket_length_by_width.guides = vec![segment(197.0, 120.0, 140.0, 96.0)];

    let mut side_pocket = marker((382.0, 260.0));
    side_pocket.shapes = vec![THOB_SIDE_POCKETS];
    side_pocket.guides = vec![segment(300.0, 260.0, 346.0, 260.0)];

    let mut mobile_pocket_length_by_width = marker((380.0, 222.0));
    mobile_pocket_length_by_width.shapes = vec![THOB_MOBILE_POCKET];
    mobile_pocket_length_by_width.guides = vec![segment(288.0, 222.0, 326.0, 222.0)];

    let mut fo_width = marker((130.0, 230.0));
    fo_width.dims = vec![segment(234.0, 192.0, 246.0, 192.0)];
    fo_width.guides = vec![segment(240.0, 196.0, 166.0, 224.0)];

    vec![
        field("lengthFl", "Front Length", true, ThobView::Front, length_fl),
        field("lengthBl", "Back Length", true, ThobView::Back, length_bl),
        field("shoulder", "Shoulder", true, ThobView::Front, shoulder),
        field("chest", "Chest", true, ThobView::Front, chest),
        field("chestUp", "Chest Up", true, ThobView::Front, chest_up),
        field("waist", "Waist", true, ThobView::Front, waist),
        field("hips", "Hips", true, ThobView::Front, hips),
        field("neck", "Neck", true, ThobView::Back, neck),
        field("neckWidth", "Neck W", true, ThobView::Back, neck_width),
        field("aramHole", "Armhole", true, ThobView::Back, aram_hole),
        field(
            "sleeveLength",
            "Sleeve",
            true,
            ThobView::Back,
            sleeve_length,
        ),
        field("openHand", "Open Hand", true, ThobView::Back, open_hand),
        field("cuffWidth", "Cuff W", true, ThobView::Back, cuff_width),
        field(
            "frantPocketLength",
            "Front Pocket",
            true,
            ThobView::Front,
            frant_pocket_length,
        ),
        field(
            "farntPocketLengthByWidth",
            "Pocket L×W",
            false,
            ThobView::Front,
            farnt_pocket_length_by_width,
        ),
        field(
            "sidePocket",
            "Side Pocket",
            false,
            ThobView::Front,
            side_pocket,
        ),
        field(
            "mobilePocketLengthByWidth",
            "Mobile Pocket",
            false,
            ThobView::Front,
            mobile_pocket_length_by_width,
        ),
        field("foWidth", "Fo Width", true, ThobView::Front, fo_width),
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

fn thob_field_names(fields: &[FieldDef], view: ThobView) -> Vec<&'static str> {
    fields
        .iter()
        .filter(|f| f.view == view)
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
/// label, a numeric one carries the unit; unrecorded fields are labelled only.
/// Same rule as `diagramCaption` in `thob-diagram.tsx`.
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

/// Places every caption for one view without overlap, nudging each box
/// vertically. Mirrors `layoutCaptions` in `thob-diagram.tsx` exactly, so the
/// printed and on-screen diagrams agree.
fn thob_captions(
    fields: &[FieldDef],
    view: ThobView,
    values: &BTreeMap<String, String>,
) -> BTreeMap<String, ThobCaption> {
    let mut sorted: Vec<&FieldDef> = fields.iter().filter(|f| f.view == view).collect();
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
        assert_eq!(amounts["amountPaid"], "400.000");
        // Paid exceeds the total — never a negative balance on a document.
        assert_eq!(amounts["balanceDue"], "0.000");
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
        measurement.side_pocket = Some("Both".to_string());
        measurement.farnt_pocket_length_by_width = Some("No 16x14".to_string());
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
                thob_garment => minijinja::Value::from_serialize(thob_garment()),
                thob_markers => minijinja::Value::from_serialize(thob_markers_map(&fields)),
                thob_front_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Front)),
                thob_back_fields => minijinja::Value::from_serialize(thob_field_names(&fields, ThobView::Back)),
                thob_front_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Front, &measurement)),
                thob_back_captions => minijinja::Value::from_serialize(thob_captions(&fields, ThobView::Back, &measurement)),
            })
            .unwrap();

        // The template is the only smoke seat: it runs the thob_callout macro
        // against every field, so a malformed marker map fails right here.
        assert!(html.contains("واجهة الثوب"));
        assert!(html.contains("خلف الثوب"));
        // Recorded numeric values ride the captions, whole numbers trimmed,
        // each paired with its short diagram label.
        assert!(html.contains("120 inch · Front Length"));
        assert!(html.contains("124 inch · Back Length"));
        assert!(html.contains("60 inch · Sleeve"));
        assert!(html.contains("38.5 inch · Waist"));
        // Text and select values are already self-describing — no "inch".
        assert!(html.contains("Both · Side Pocket"));
        assert!(!html.contains("No inch"));
        // Unrecorded fields still get a labelled caption point.
        assert!(html.contains(">Front Pocket<"));
        assert!(html.contains(">Fo Width<"));
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
        invoice_id: uuid::Uuid::nil(),
        invoice_date: chrono::NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
        measurement_id: uuid::Uuid::nil(),
        customer_name: "Ahmed".to_string(),
        customer_mobile: "+973 0000".to_string(),
        material: "Cotton".to_string(),
        material_amount: 3.5,
        price: 100.0,
        status: "pending".to_string(),
        production_location_id: None,
        production_location: None,
        production_location_inferred: false,
        receiving_location_id: None,
        receiving_location: None,
        stages: Vec::new(),
        current_stage: None,
        repairs: Vec::new(),
        invoice_total_price: 300.0,
        invoice_amount_paid: 400.0,
        invoice_payment_status: "partial".to_string(),
        invoice_advance_amount: 120.0,
        invoice_advance_payment_type: None,
        invoice_final_payment_type: None,
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
            sleeve_length: Some(60.0),
            neck: None,
            open_hand: None,
            chest_up: None,
            cuff_width: None,
            neck_width: None,
            aram_hole: None,
            fo_width: None,
            frant_pocket_length: None,
            farnt_pocket_length_by_width: None,
            side_pocket: None,
            mobile_pocket_length_by_width: None,
        }
    }
}
