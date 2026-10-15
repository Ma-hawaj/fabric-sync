//! Renders a repair as a self-contained HTML slip.
//!
//! The same reasoning as the invoice/order documents: HTML rather than PDF
//! because Arabic needs a real text shaper and the browser already is one.
//! Nothing in the page is fetched at render time: styles are inline and the
//! logo (if any) is a `data:` URI.

use minijinja::{context, Environment};
use serde::Serialize;
use std::collections::BTreeMap;

use crate::{
    config::InvoiceBranding,
    document::{format_amount, format_datetime, format_quantity, CURRENCY},
    error::AppError,
    features::customers::types::Measurement,
    state::AppState,
};

use super::{repository, service};

/// The copy of the template compiled into the binary, used unless
/// `INVOICE_TEMPLATE_DIR` points somewhere else (all documents live in the
/// same templates directory).
const DEFAULT_TEMPLATE: &str = include_str!("../../../templates/repair.html");

const TEMPLATE_NAME: &str = "repair.html";

/// One changed measurement on the slip: the field key, its display label, and
/// the before/after values as display strings (`"—"` when unset).
#[derive(Serialize)]
struct MeasurementChange {
    field: &'static str,
    label: &'static str,
    before: String,
    after: String,
}

fn display_number(value: Option<f64>) -> String {
    match value {
        Some(value) => format_quantity(value),
        None => "—".to_string(),
    }
}

fn display_text(value: &Option<String>) -> String {
    match value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => value.to_string(),
        None => "—".to_string(),
    }
}

fn raw_number(value: Option<f64>) -> String {
    match value {
        Some(value) => format!("{value:.2}"),
        None => String::new(),
    }
}

fn raw_text(value: &Option<String>) -> String {
    value
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

/// The measurement fix as a before→after diff. Only fields that changed are
/// listed, so the slip reads as "what the repair fixed" rather than a full
/// re-measurement. `None` (no fix recorded) yields an empty list and the
/// template prints "no measurement changes" instead.
fn measurement_changes(
    before: &Measurement,
    after: Option<&Measurement>,
) -> Vec<MeasurementChange> {
    let Some(after) = after else {
        return Vec::new();
    };

    let numbers: [(&'static str, &'static str, Option<f64>, Option<f64>); 27] = [
        (
            "lengthFl",
            "Length (Front)",
            before.length_fl,
            after.length_fl,
        ),
        (
            "lengthBl",
            "Length (Back)",
            before.length_bl,
            after.length_bl,
        ),
        ("shoulder", "Shoulder", before.shoulder, after.shoulder),
        (
            "shoulderDown",
            "Shoulder Down",
            before.shoulder_down,
            after.shoulder_down,
        ),
        ("chest", "Chest", before.chest, after.chest),
        ("chestUp", "Chest (Upper)", before.chest_up, after.chest_up),
        ("waist", "Waist", before.waist, after.waist),
        ("hips", "Hips", before.hips, after.hips),
        (
            "sleeveLength",
            "Sleeve Length",
            before.sleeve_length,
            after.sleeve_length,
        ),
        ("neck", "Neck", before.neck, after.neck),
        (
            "neckWidth",
            "Neck Width",
            before.neck_width,
            after.neck_width,
        ),
        ("openHand", "Open Hand", before.open_hand, after.open_hand),
        (
            "openHandFolding",
            "Open Hand Folding",
            before.open_hand_folding,
            after.open_hand_folding,
        ),
        (
            "cuffWidth",
            "Cuff Width",
            before.cuff_width,
            after.cuff_width,
        ),
        ("cuffling", "Cuffling", before.cuffling, after.cuffling),
        ("armHole", "Armhole", before.arm_hole, after.arm_hole),
        ("foWidth", "FO Width", before.fo_width, after.fo_width),
        ("fo", "Fo", before.fo, after.fo),
        ("bottom", "Bottom", before.bottom, after.bottom),
        (
            "bottomFolding",
            "Bottom Folding",
            before.bottom_folding,
            after.bottom_folding,
        ),
        ("fullBody", "Full Body", before.full_body, after.full_body),
        (
            "sleeveHalf",
            "Sleeve Half",
            before.sleeve_half,
            after.sleeve_half,
        ),
        ("button", "Button", before.button, after.button),
        (
            "buttonFold",
            "Button Fold",
            before.button_fold,
            after.button_fold,
        ),
        ("openFold", "Open Fold", before.open_fold, after.open_fold),
        (
            "frontPocketLength",
            "Front Pocket Length",
            before.front_pocket_length,
            after.front_pocket_length,
        ),
        (
            "sidePocketLength",
            "Side Pocket Length",
            before.side_pocket_length,
            after.side_pocket_length,
        ),
    ];

    let mut changes = Vec::new();
    for (field, label, before_value, after_value) in numbers {
        if raw_number(before_value) != raw_number(after_value) {
            changes.push(MeasurementChange {
                field,
                label,
                before: display_number(before_value),
                after: display_number(after_value),
            });
        }
    }

    let texts: [(&'static str, &'static str, &Option<String>, &Option<String>); 3] = [
        (
            "frontPocketLengthByWidth",
            "Front Pocket L×W",
            &before.front_pocket_length_by_width,
            &after.front_pocket_length_by_width,
        ),
        (
            "sidePocketLengthByWidth",
            "Side Pocket L×W",
            &before.side_pocket_length_by_width,
            &after.side_pocket_length_by_width,
        ),
        (
            "mobilePocketLengthByWidth",
            "Mobile Pocket L×W",
            &before.mobile_pocket_length_by_width,
            &after.mobile_pocket_length_by_width,
        ),
    ];

    for (field, label, before_value, after_value) in texts {
        if raw_text(before_value) != raw_text(after_value) {
            changes.push(MeasurementChange {
                field,
                label,
                before: display_text(before_value),
                after: display_text(after_value),
            });
        }
    }

    changes
}

fn environment(branding: &InvoiceBranding) -> Result<Environment<'static>, AppError> {
    crate::document::template_environment(branding, TEMPLATE_NAME, DEFAULT_TEMPLATE)
}

pub async fn render_repair_document(
    state: &AppState,
    order_id: uuid::Uuid,
    repair_id: uuid::Uuid,
) -> Result<String, AppError> {
    if !repository::repair_belongs_to_order(state, repair_id, order_id).await? {
        return Err(AppError::NotFound(format!(
            "repair {repair_id} not found on order {order_id}"
        )));
    }

    let detail = service::get_order(state, order_id).await?;
    let repair = detail
        .order
        .repairs
        .iter()
        .find(|repair| repair.id == repair_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("repair {repair_id} not found")))?;

    let fixed = match repair.fixed_measurement_id {
        Some(id) => crate::features::customers::repository::get_measurement(state, id).await?,
        None => None,
    };

    let branding = state.invoice_branding();
    let env = environment(branding)?;
    let template = env.get_template(TEMPLATE_NAME)?;

    let mut amounts = BTreeMap::new();
    amounts.insert("charge".to_string(), format_amount(repair.charge));
    amounts.insert(
        "receivedAmount".to_string(),
        format_amount(repair.received_amount),
    );

    Ok(template.render(context! {
        repair => minijinja::Value::from_serialize(&repair),
        order => minijinja::Value::from_serialize(&detail),
        company => minijinja::Value::from_serialize(branding),
        currency => CURRENCY,
        amounts => minijinja::Value::from_serialize(&amounts),
        reported_on => repair.reported_on.to_string(),
        completed_at => repair.completed_at.as_ref().map(format_datetime),
        received_at => repair.received_at.as_ref().map(format_datetime),
        measurement_changes => minijinja::Value::from_serialize(&measurement_changes(&detail.measurement, fixed.as_ref())),
        has_fix => fixed.is_some(),
    })?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use uuid::Uuid;

    fn measurement(chest: Option<f64>, waist: Option<f64>) -> Measurement {
        Measurement {
            id: Uuid::nil(),
            customer_id: Uuid::nil(),
            date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            length_fl: None,
            length_bl: None,
            chest,
            waist,
            hips: None,
            shoulder: None,
            shoulder_down: None,
            sleeve_length: None,
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

    #[test]
    fn no_fix_means_no_changes() {
        let before = measurement(Some(108.0), None);
        assert!(measurement_changes(&before, None).is_empty());
    }

    #[test]
    fn only_changed_fields_are_listed() {
        let before = measurement(Some(108.0), Some(96.0));
        let after = measurement(Some(110.0), Some(96.0));

        let changes = measurement_changes(&before, Some(&after));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].field, "chest");
        assert_eq!(changes[0].before, "108");
        assert_eq!(changes[0].after, "110");
    }

    #[test]
    fn identical_snapshots_list_nothing() {
        let before = measurement(Some(108.0), None);
        let after = measurement(Some(108.0), None);

        assert!(measurement_changes(&before, Some(&after)).is_empty());
    }
}
