use chrono::NaiveDate;
use serde::Serialize;

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub id: String,
    pub customer_id: String,
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

    pub thobe_type_1: Option<String>,
    pub f_pocket_1: Option<String>,
    pub collar_1: Option<String>,
    pub sleeve_1: Option<String>,
    pub patti_1: Option<String>,
    pub more_details_1: Option<String>,

    pub thobe_type_2: Option<String>,
    pub f_pocket_2: Option<String>,
    pub collar_2: Option<String>,
    pub sleeve_2: Option<String>,
    pub patti_2: Option<String>,
    pub more_details_2: Option<String>,

    pub thobe_type_3: Option<String>,
    pub f_pocket_3: Option<String>,
    pub collar_3: Option<String>,
    pub sleeve_3: Option<String>,
    pub patti_3: Option<String>,
    pub more_details_3: Option<String>,

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

// Not FromRow-derived: `measurements` isn't a column, and query_as!'s
// compile-time codegen requires an exact field-for-column match (the
// #[sqlx(default)]/#[sqlx(skip)] escape hatches only apply to the FromRow
// trait's runtime path, e.g. via `query_as::<_, T>`, not the macro).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub mobile_no: String,
    pub measurements: Vec<Measurement>,
}
