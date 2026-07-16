use std::collections::HashMap;

use crate::state::AppState;
use sqlx::Row;

use super::types::{Customer, Measurement};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, sqlx::Error> {
    let customer_rows = sqlx::query(
        r#"
        SELECT id, name, mobile_no
        FROM customers
        ORDER BY id
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let measurement_rows = sqlx::query(
        r#"
        SELECT
            id,
            customer_id,
            measurement_date,
            length_fl::float8 AS length_fl,
            length_bl::float8 AS length_bl,
            chest::float8 AS chest,
            waist::float8 AS waist,
            hips::float8 AS hips,
            shoulder::float8 AS shoulder,
            sleeve_length::float8 AS sleeve_length,
            neck::float8 AS neck,
            open_hand::float8 AS open_hand,
            cuffling,
            thobe_type_1,
            f_pocket_1,
            collar_1,
            sleeve_1,
            patti_1,
            more_details_1,
            thobe_type_2,
            f_pocket_2,
            collar_2,
            sleeve_2,
            patti_2,
            more_details_2,
            thobe_type_3,
            f_pocket_3,
            collar_3,
            sleeve_3,
            patti_3,
            more_details_3,
            full_body,
            chest_up::float8 AS chest_up,
            open_fold,
            cuff_width::float8 AS cuff_width,
            neck_width::float8 AS neck_width,
            aram_hole::float8 AS aram_hole,
            sleeve_haff_button,
            button_fold,
            fo,
            fo_width::float8 AS fo_width,
            frant_pocket_length::float8 AS frant_pocket_length,
            farnt_pocket_length_by_width,
            side_pocket,
            mobile_pocket_length_by_width
        FROM measurements
        ORDER BY customer_id, measurement_date DESC, id DESC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let mut measurements_by_customer: HashMap<i64, Vec<Measurement>> = HashMap::new();
    for row in measurement_rows {
        let customer_id: i64 = row.get("customer_id");
        let measurement = Measurement {
            id: row.get::<i64, _>("id").to_string(),
            customer_id: customer_id.to_string(),
            date: row.get("measurement_date"),
            length_fl: row.get("length_fl"),
            length_bl: row.get("length_bl"),
            chest: row.get("chest"),
            waist: row.get("waist"),
            hips: row.get("hips"),
            shoulder: row.get("shoulder"),
            sleeve_length: row.get("sleeve_length"),
            neck: row.get("neck"),
            open_hand: row.get("open_hand"),
            cuffling: row.get("cuffling"),
            thobe_type_1: row.get("thobe_type_1"),
            f_pocket_1: row.get("f_pocket_1"),
            collar_1: row.get("collar_1"),
            sleeve_1: row.get("sleeve_1"),
            patti_1: row.get("patti_1"),
            more_details_1: row.get("more_details_1"),
            thobe_type_2: row.get("thobe_type_2"),
            f_pocket_2: row.get("f_pocket_2"),
            collar_2: row.get("collar_2"),
            sleeve_2: row.get("sleeve_2"),
            patti_2: row.get("patti_2"),
            more_details_2: row.get("more_details_2"),
            thobe_type_3: row.get("thobe_type_3"),
            f_pocket_3: row.get("f_pocket_3"),
            collar_3: row.get("collar_3"),
            sleeve_3: row.get("sleeve_3"),
            patti_3: row.get("patti_3"),
            more_details_3: row.get("more_details_3"),
            full_body: row.get("full_body"),
            chest_up: row.get("chest_up"),
            open_fold: row.get("open_fold"),
            cuff_width: row.get("cuff_width"),
            neck_width: row.get("neck_width"),
            aram_hole: row.get("aram_hole"),
            sleeve_haff_button: row.get("sleeve_haff_button"),
            button_fold: row.get("button_fold"),
            fo: row.get("fo"),
            fo_width: row.get("fo_width"),
            frant_pocket_length: row.get("frant_pocket_length"),
            farnt_pocket_length_by_width: row.get("farnt_pocket_length_by_width"),
            side_pocket: row.get("side_pocket"),
            mobile_pocket_length_by_width: row.get("mobile_pocket_length_by_width"),
        };
        measurements_by_customer
            .entry(customer_id)
            .or_default()
            .push(measurement);
    }

    Ok(customer_rows
        .into_iter()
        .map(|row| {
            let id: i64 = row.get("id");
            Customer {
                id: id.to_string(),
                name: row.get("name"),
                mobile_no: row.get("mobile_no"),
                measurements: measurements_by_customer.remove(&id).unwrap_or_default(),
            }
        })
        .collect())
}
