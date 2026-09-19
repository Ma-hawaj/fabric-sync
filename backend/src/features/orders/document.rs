//! Renders an order as a self-contained HTML document.
//!
//! The same reasoning applies as for the invoice document: HTML rather than a
//! PDF because Arabic needs a real text shaper and the browser already is one.
//! The page is printed to PDF by whatever renders it — today the user's
//! browser through an iframe, later a headless browser with no template
//! rewrite. Nothing in the page is fetched at render time.

use std::collections::BTreeMap;

use minijinja::{context, Environment};

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

    let env = environment(branding)?;
    let template = env.get_template(TEMPLATE_NAME)?;

    Ok(template.render(context! {
        order => minijinja::Value::from_serialize(&detail),
        company => minijinja::Value::from_serialize(branding),
        currency => CURRENCY,
        // Amounts are pre-formatted rather than left to the template, so that
        // editing the design can't accidentally change how money is written.
        amounts => minijinja::Value::from_serialize(formatted_amounts(&detail)),
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
            cuffling: None,
            full_body: None,
            chest_up: None,
            open_fold: None,
            cuff_width: None,
            neck_width: None,
            aram_hole: None,
            sleeve_haff_button: None,
            button_fold: None,
            fo: None,
            fo_width: None,
            frant_pocket_length: None,
            farnt_pocket_length_by_width: None,
            side_pocket: None,
            mobile_pocket_length_by_width: None,
        }
    }
}
