use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

// What a measurement snapshot describes: the customer's body as measured, an
// existing thobe copied stitch-for-stitch, or a sample kept on file. How the
// garment should be cut: loose, fitted, or somewhere in between.
pub const MEASUREMENT_TYPES: &[&str] = &["body", "thobe", "sample"];
pub const MEASUREMENT_FITS: &[&str] = &["loose", "fit", "medium"];

// Decoded from Postgres' `to_jsonb(measurements)` (see repository.rs), whose
// keys are the raw column names, then re-serialized to the frontend as
// camelCase — hence the asymmetric rename_all. `date` is the one field whose
// column name (`measurement_date`) doesn't match the Rust field name, so it
// needs its own deserialize-only rename on top of that.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Measurement {
    pub id: Uuid,
    pub customer_id: Uuid,
    #[serde(rename(deserialize = "measurement_date"))]
    pub date: NaiveDate,

    // Record-level choices rather than lengths: what was measured and how to
    // cut it. Nullable so legacy rows (written before these existed) keep
    // reading — every new write has to set them (see validate_measurement).
    pub r#type: Option<String>,
    pub fit: Option<String>,

    pub front_height: Option<f64>,
    pub back_height: Option<f64>,
    pub chest: Option<f64>,
    pub waist: Option<f64>,
    pub hip: Option<f64>,
    pub shoulder: Option<f64>,
    pub shoulder_down: Option<f64>,
    pub sleeve_length: Option<f64>,
    pub neck_size: Option<f64>,
    pub open_hand: Option<f64>,
    pub chest_up: Option<f64>,
    pub cuff_width: Option<f64>,
    pub cuff_size: Option<f64>,
    pub neck_width: Option<f64>,
    pub armhole: Option<f64>,
    pub fo_width: Option<f64>,
    pub fo: Option<f64>,
    pub bottom: Option<f64>,
    pub bottom_fold: Option<f64>,
    pub full_body: Option<f64>,
    pub sleeve_half: Option<f64>,
    pub open_fold: Option<f64>,
    pub front_pocket_length: Option<f64>,
    pub front_pocket_length_by_width: Option<String>,
    pub side_pocket: Option<f64>,
    pub side_pocket_length_by_width: Option<String>,
    pub mobile_pocket_length_by_width: Option<String>,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub whatsapp_notifications_enabled: bool,
    pub id: Uuid,
    pub name: String,
    pub mobile_no: String,
    pub address: Option<String>,
    // Postgres builds this array itself (see the repository's `json_agg`), so
    // it decodes straight off the row rather than being grouped app-side.
    #[sqlx(json)]
    pub measurements: Vec<Measurement>,
    // The customer's invoices — tailoring invoices through their orders plus
    // retail sales billed to them directly. One read carries the sheet's whole
    // invoice history, so no second request filtered by phone number is needed.
    #[sqlx(json)]
    pub invoices: Vec<CustomerInvoiceSummary>,
}

/// One invoice as embedded on a customer: identity, date, money state —
/// enough for the sheet's history with a link to the full page.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInvoiceSummary {
    pub id: Uuid,
    pub invoice_number: i64,
    pub invoice_date: DateTime<Utc>,
    pub target_date: Option<NaiveDate>,
    pub total_price: f64,
    pub payment_status: String,
    pub balance_due: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMeasurementInput {
    pub date: NaiveDate,

    pub r#type: Option<String>,
    pub fit: Option<String>,

    pub front_height: Option<f64>,
    pub back_height: Option<f64>,
    pub chest: Option<f64>,
    pub waist: Option<f64>,
    pub hip: Option<f64>,
    pub shoulder: Option<f64>,
    pub shoulder_down: Option<f64>,
    pub sleeve_length: Option<f64>,
    pub neck_size: Option<f64>,
    pub open_hand: Option<f64>,
    pub chest_up: Option<f64>,
    pub cuff_width: Option<f64>,
    pub cuff_size: Option<f64>,
    pub neck_width: Option<f64>,
    pub armhole: Option<f64>,
    pub fo_width: Option<f64>,
    pub fo: Option<f64>,
    pub bottom: Option<f64>,
    pub bottom_fold: Option<f64>,
    pub full_body: Option<f64>,
    pub sleeve_half: Option<f64>,
    pub open_fold: Option<f64>,
    pub front_pocket_length: Option<f64>,
    pub front_pocket_length_by_width: Option<String>,
    pub side_pocket: Option<f64>,
    pub side_pocket_length_by_width: Option<String>,
    pub mobile_pocket_length_by_width: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerInput {
    pub name: String,
    pub mobile_no: String,
    #[serde(default = "default_whatsapp_notifications_enabled")]
    pub whatsapp_notifications_enabled: bool,
    pub address: Option<String>,
    #[serde(default)]
    pub measurement: Option<CreateMeasurementInput>,
}

fn default_whatsapp_notifications_enabled() -> bool {
    true
}

/// Every field is optional so a partial update (e.g. just `mobileNo`) stays a
/// single statement rather than a read-modify-write.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCustomerInput {
    pub name: Option<String>,
    pub mobile_no: Option<String>,
    pub whatsapp_notifications_enabled: Option<bool>,
    /// Omitted leaves it unchanged; an empty string clears the address.
    pub address: Option<String>,
}

// Two snapshots count as "the same measurement" if every measured field
// matches, regardless of date — used by the invoices feature to skip
// inserting a new row when nothing actually changed since the customer's
// last visit.
pub fn measurement_values_equal(a: &CreateMeasurementInput, b: &CreateMeasurementInput) -> bool {
    CreateMeasurementInput {
        date: b.date,
        ..a.clone()
    } == *b
}

// Type and fit are required on every new snapshot. Legacy rows predate them
// and stay NULL in the database — validation only runs on writes, never on
// reads, so those rows keep loading.
pub fn validate_measurement(measurement: &CreateMeasurementInput) -> Result<(), AppError> {
    let r#type = measurement.r#type.as_deref().unwrap_or("");
    if !MEASUREMENT_TYPES.contains(&r#type) {
        return Err(AppError::BadRequest(
            "a measurement needs a type of body, thobe, or sample".to_string(),
        ));
    }

    let fit = measurement.fit.as_deref().unwrap_or("");
    if !MEASUREMENT_FITS.contains(&fit) {
        return Err(AppError::BadRequest(
            "a measurement needs a fit of loose, fit, or medium".to_string(),
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn measurement(chest: Option<f64>, pocket: Option<&str>) -> CreateMeasurementInput {
        CreateMeasurementInput {
            date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            r#type: Some("body".to_string()),
            fit: Some("medium".to_string()),
            front_height: None,
            back_height: None,
            chest,
            waist: None,
            hip: None,
            shoulder: None,
            shoulder_down: None,
            sleeve_length: None,
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
            front_pocket_length_by_width: pocket.map(str::to_string),
            side_pocket: None,
            side_pocket_length_by_width: None,
            mobile_pocket_length_by_width: None,
        }
    }

    #[test]
    fn measurement_values_equal_ignores_date() {
        let mut a = measurement(Some(108.0), Some("16x14"));
        let mut b = a.clone();
        a.date = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        b.date = NaiveDate::from_ymd_opt(2026, 7, 1).unwrap();

        assert!(measurement_values_equal(&a, &b));
    }

    #[test]
    fn measurement_values_equal_detects_a_changed_field() {
        let a = measurement(Some(108.0), Some("16x14"));
        let b = measurement(Some(110.0), Some("16x14"));

        assert!(!measurement_values_equal(&a, &b));
    }

    #[test]
    fn measurement_values_equal_detects_a_field_becoming_blank() {
        let a = measurement(Some(108.0), Some("16x14"));
        let b = measurement(Some(108.0), None);

        assert!(!measurement_values_equal(&a, &b));
    }

    // Guards the asymmetric rename_all in repository.rs's
    // `to_jsonb(measurements)` decode path: deserialize must accept the raw
    // column names Postgres produces, and serialize must still emit
    // camelCase for the frontend.
    #[test]
    fn measurement_round_trips_through_postgres_json_shape() {
        let postgres_json = r#"{
            "id": "4b87bb2b-cf72-476c-8446-7b30c46f0ad5",
            "customer_id": "adcdd125-7101-4e93-ba4d-c9a7fe9fca1f",
            "measurement_date": "2026-07-01",
            "type": "thobe", "fit": "loose",
            "front_height": 152.5, "back_height": null, "chest": 108.0, "waist": null,
            "hip": null, "shoulder": null, "shoulder_down": null, "sleeve_length": null, "neck_size": null,
            "open_hand": null, "chest_up": null,
            "cuff_width": null, "cuff_size": null, "neck_width": null, "armhole": null,
            "fo_width": null, "fo": null, "bottom": null, "bottom_fold": null, "full_body": null,
            "sleeve_half": null, "open_fold": null,
            "front_pocket_length": null,
            "front_pocket_length_by_width": "16x14",
            "side_pocket": null, "side_pocket_length_by_width": null,
            "mobile_pocket_length_by_width": null,
            "sleeve_half_button": null
        }"#;

        let measurement: Measurement = serde_json::from_str(postgres_json).unwrap();
        assert_eq!(
            measurement.front_pocket_length_by_width.as_deref(),
            Some("16x14")
        );
        assert_eq!(measurement.front_height, Some(152.5));
        assert_eq!(measurement.r#type.as_deref(), Some("thobe"));
        assert_eq!(measurement.fit.as_deref(), Some("loose"));

        let api_json = serde_json::to_value(&measurement).unwrap();
        assert_eq!(api_json["frontHeight"], 152.5);
        assert!(api_json["fullBody"].is_null());
        assert!(api_json["fo"].is_null());
        assert_eq!(api_json["type"], "thobe");
        assert_eq!(api_json["fit"], "loose");
        assert_eq!(
            api_json["customerId"],
            "adcdd125-7101-4e93-ba4d-c9a7fe9fca1f"
        );
        assert_eq!(api_json["date"], "2026-07-01");
        assert!(api_json.get("measurement_date").is_none());
    }

    #[test]
    fn validate_measurement_accepts_known_types_and_fits() {
        for r#type in MEASUREMENT_TYPES {
            for fit in MEASUREMENT_FITS {
                let mut m = measurement(None, None);
                m.r#type = Some(r#type.to_string());
                m.fit = Some(fit.to_string());
                assert!(validate_measurement(&m).is_ok());
            }
        }
    }

    #[test]
    fn validate_measurement_rejects_a_missing_or_noncanonical_type() {
        for r#type in [
            None,
            Some(""),
            Some("shirt"),
            Some("BODY"),
            Some(" body"),
            Some("thobe "),
            Some("\tsample\n"),
        ] {
            let mut m = measurement(None, None);
            m.r#type = r#type.map(str::to_string);
            let error = validate_measurement(&m).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)));
        }
    }

    #[test]
    fn validate_measurement_rejects_a_missing_or_noncanonical_fit() {
        for fit in [
            None,
            Some(""),
            Some("tight"),
            Some("LOOSE"),
            Some(" loose"),
            Some("fit "),
            Some("\tmedium\n"),
        ] {
            let mut m = measurement(None, None);
            m.fit = fit.map(str::to_string);
            let error = validate_measurement(&m).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)));
        }
    }

    #[test]
    fn measurement_values_equal_notices_a_changed_type_or_fit() {
        let a = measurement(None, None);
        let mut b = a.clone();
        b.r#type = Some("sample".to_string());
        assert!(!measurement_values_equal(&a, &b));

        let mut c = a.clone();
        c.fit = Some("loose".to_string());
        assert!(!measurement_values_equal(&a, &c));
    }
}
