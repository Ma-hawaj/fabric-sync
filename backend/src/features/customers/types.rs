use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

    pub length_fl: Option<f64>,
    pub length_bl: Option<f64>,
    pub chest: Option<f64>,
    pub waist: Option<f64>,
    pub hips: Option<f64>,
    pub shoulder: Option<f64>,
    pub sleeve_length: Option<f64>,
    pub neck: Option<f64>,
    pub open_hand: Option<f64>,
    pub cuffling: Option<String>,

    pub full_body: Option<String>,
    pub chest_up: Option<f64>,
    pub open_fold: Option<String>,
    pub cuff_width: Option<f64>,
    pub neck_width: Option<f64>,
    pub aram_hole: Option<f64>,
    pub sleeve_haff_button: Option<String>,
    pub button_fold: Option<String>,
    pub fo: Option<String>,
    pub fo_width: Option<f64>,
    pub frant_pocket_length: Option<f64>,
    pub farnt_pocket_length_by_width: Option<String>,
    pub side_pocket: Option<String>,
    pub mobile_pocket_length_by_width: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: Uuid,
    pub name: String,
    pub mobile_no: String,
    pub measurements: Vec<Measurement>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMeasurementInput {
    pub date: NaiveDate,

    pub length_fl: Option<f64>,
    pub length_bl: Option<f64>,
    pub chest: Option<f64>,
    pub waist: Option<f64>,
    pub hips: Option<f64>,
    pub shoulder: Option<f64>,
    pub sleeve_length: Option<f64>,
    pub neck: Option<f64>,
    pub open_hand: Option<f64>,
    pub cuffling: Option<String>,

    pub full_body: Option<String>,
    pub chest_up: Option<f64>,
    pub open_fold: Option<String>,
    pub cuff_width: Option<f64>,
    pub neck_width: Option<f64>,
    pub aram_hole: Option<f64>,
    pub sleeve_haff_button: Option<String>,
    pub button_fold: Option<String>,
    pub fo: Option<String>,
    pub fo_width: Option<f64>,
    pub frant_pocket_length: Option<f64>,
    pub farnt_pocket_length_by_width: Option<String>,
    pub side_pocket: Option<String>,
    pub mobile_pocket_length_by_width: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerInput {
    pub name: String,
    pub mobile_no: String,
    #[serde(default)]
    pub measurement: Option<CreateMeasurementInput>,
}

#[cfg(test)]
mod tests {
    use super::*;

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
            "length_fl": 152.5, "length_bl": null, "chest": 108.0, "waist": null,
            "hips": null, "shoulder": null, "sleeve_length": null, "neck": null,
            "open_hand": null, "cuffling": "Double Cuff",
            "full_body": null, "chest_up": null, "open_fold": null,
            "cuff_width": null, "neck_width": null, "aram_hole": null,
            "sleeve_haff_button": null, "button_fold": null, "fo": null,
            "fo_width": null, "frant_pocket_length": null,
            "farnt_pocket_length_by_width": null, "side_pocket": null,
            "mobile_pocket_length_by_width": null
        }"#;

        let measurement: Measurement = serde_json::from_str(postgres_json).unwrap();
        assert_eq!(measurement.cuffling.as_deref(), Some("Double Cuff"));
        assert_eq!(measurement.length_fl, Some(152.5));

        let api_json = serde_json::to_value(&measurement).unwrap();
        assert_eq!(api_json["lengthFl"], 152.5);
        assert_eq!(
            api_json["customerId"],
            "adcdd125-7101-4e93-ba4d-c9a7fe9fca1f"
        );
        assert_eq!(api_json["date"], "2026-07-01");
        assert!(api_json.get("measurement_date").is_none());
    }
}
