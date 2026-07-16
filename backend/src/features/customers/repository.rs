use std::collections::HashMap;

use crate::state::AppState;

use super::types::{Customer, Measurement};

pub async fn list_customers(state: &AppState) -> Result<Vec<Customer>, sqlx::Error> {
    let customer_rows = sqlx::query!(
        r#"
        SELECT id, name, mobile_no
        FROM customers
        ORDER BY id
        "#,
    )
    .fetch_all(state.db())
    .await?;

    let measurements = sqlx::query_as!(
        Measurement,
        r#"
        SELECT
            id::text AS "id!",
            customer_id::text AS "customer_id!",
            measurement_date AS "date!",
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

    let mut measurements_by_customer: HashMap<String, Vec<Measurement>> = HashMap::new();
    for measurement in measurements {
        measurements_by_customer
            .entry(measurement.customer_id.clone())
            .or_default()
            .push(measurement);
    }

    Ok(customer_rows
        .into_iter()
        .map(|row| {
            let id = row.id.to_string();
            Customer {
                measurements: measurements_by_customer.remove(&id).unwrap_or_default(),
                id,
                name: row.name,
                mobile_no: row.mobile_no,
            }
        })
        .collect())
}
