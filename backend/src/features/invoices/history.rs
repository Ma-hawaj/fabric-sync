use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::features::{customers::types::CreateMeasurementInput, returns::types::ReturnedLine};

use super::types::{
    InvoiceEdit, InvoiceEditCustomer, InvoiceEditMaterialLine, InvoiceEditOrder,
    InvoiceEditProductLine, InvoicePayment,
};

/// One field that differs between two versions of an invoice. Values are
/// already display-formatted so the stored JSON reads the way the UI shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldChange {
    pub path: String,
    pub label: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

/// A chronological invoice event. Edits carry field diffs; payments,
/// collections, returns and refunds are merged from their existing ledgers.
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum InvoiceHistoryEntry {
    Created {
        at: DateTime<Utc>,
        actor: Option<String>,
    },
    Edited {
        id: Uuid,
        at: DateTime<Utc>,
        actor: Option<String>,
        changes: Vec<FieldChange>,
        total_before: Option<f64>,
        total_after: Option<f64>,
    },
    Payment {
        id: Uuid,
        at: DateTime<Utc>,
        actor: Option<String>,
        amount: f64,
        payment_type: Option<String>,
        order_id: Option<Uuid>,
    },
    Collection {
        order_id: Uuid,
        order_number: i64,
        at: DateTime<Utc>,
    },
    Return {
        id: Uuid,
        at: DateTime<Utc>,
        actor: String,
        return_kind: String,
        reason: String,
        amount: f64,
        lines: Vec<ReturnedLine>,
    },
    Refund {
        id: Uuid,
        at: DateTime<Utc>,
        actor: String,
        reason: String,
        amount: f64,
        payment_type: String,
        gift_card_code: Option<String>,
    },
}

impl InvoiceHistoryEntry {
    pub fn occurred_at(&self) -> DateTime<Utc> {
        match self {
            Self::Created { at, .. }
            | Self::Edited { at, .. }
            | Self::Payment { at, .. }
            | Self::Collection { at, .. }
            | Self::Return { at, .. }
            | Self::Refund { at, .. } => *at,
        }
    }
}

/// Diffs two edit snapshots. `order_identity`/`item_identity` map a rebuilt
/// row's new id back to the original id the client sent, so an unchanged line
/// is reported as the same line rather than an unrelated add/remove pair.
pub fn diff_invoice_edits(
    before: &InvoiceEdit,
    after: &InvoiceEdit,
    order_identity: &HashMap<Uuid, Uuid>,
    item_identity: &HashMap<Uuid, Uuid>,
) -> Vec<FieldChange> {
    let mut changes = Vec::new();
    diff_header(&mut changes, before, after);
    diff_customers(&mut changes, before, after, order_identity);
    diff_products(&mut changes, before, after, item_identity);
    diff_materials(&mut changes, before, after, item_identity);
    diff_gift_cards(&mut changes, before, after);
    diff_redemptions(&mut changes, before, after);
    changes
}

fn diff_header(changes: &mut Vec<FieldChange>, before: &InvoiceEdit, after: &InvoiceEdit) {
    change(
        changes,
        "header.targetDate",
        "Target date",
        opt_date_str(&before.target_date).as_deref(),
        opt_date_str(&after.target_date).as_deref(),
    );
    change(
        changes,
        "header.discount",
        "Discount",
        num(before.discount).as_deref(),
        num(after.discount).as_deref(),
    );
    change(
        changes,
        "header.discountUnit",
        "Discount unit",
        Some(before.discount_unit.as_str()),
        Some(after.discount_unit.as_str()),
    );
    change(
        changes,
        "header.collectionMethod",
        "Collection method",
        Some(before.collection_method.as_str()),
        Some(after.collection_method.as_str()),
    );
    change(
        changes,
        "header.branchId",
        "Pickup location",
        opt_str(&before.branch_name).as_deref(),
        opt_str(&after.branch_name).as_deref(),
    );
    change(
        changes,
        "header.issuingBranchId",
        "Issuing location",
        opt_str(&before.issuing_branch_name).as_deref(),
        opt_str(&after.issuing_branch_name).as_deref(),
    );
    change(
        changes,
        "header.deliveryCharge",
        "Delivery charge",
        num(before.delivery_charge).as_deref(),
        num(after.delivery_charge).as_deref(),
    );
}

fn diff_customers(
    changes: &mut Vec<FieldChange>,
    before: &InvoiceEdit,
    after: &InvoiceEdit,
    order_identity: &HashMap<Uuid, Uuid>,
) {
    let before_by_id: HashMap<Uuid, &InvoiceEditCustomer> = before
        .customers
        .iter()
        .map(|c| (c.existing_customer_id, c))
        .collect();
    let after_by_id: HashMap<Uuid, &InvoiceEditCustomer> = after
        .customers
        .iter()
        .map(|c| (c.existing_customer_id, c))
        .collect();

    for (id, customer) in &before_by_id {
        let Some(updated) = after_by_id.get(id) else {
            changes.push(FieldChange {
                path: format!("customers[{id}]"),
                label: "Customer".into(),
                before: Some(customer_label(customer)),
                after: None,
            });
            continue;
        };
        let base = format!("customers[{id}]");
        change(
            changes,
            format!("{base}.name"),
            "Customer name",
            Some(customer.customer_name.as_str()),
            Some(updated.customer_name.as_str()),
        );
        change(
            changes,
            format!("{base}.mobile"),
            "Customer mobile",
            Some(customer.customer_mobile_no.as_str()),
            Some(updated.customer_mobile_no.as_str()),
        );
        change(
            changes,
            format!("{base}.address"),
            "Customer address",
            opt_str(&customer.customer_address).as_deref(),
            opt_str(&updated.customer_address).as_deref(),
        );
        changes.extend(measurement_changes(
            &format!("{base}.measurement"),
            &customer.measurement,
            &updated.measurement,
        ));
        diff_orders(changes, &base, customer, updated, order_identity);
    }

    for (id, customer) in &after_by_id {
        if !before_by_id.contains_key(id) {
            changes.push(FieldChange {
                path: format!("customers[{id}]"),
                label: "Customer".into(),
                before: None,
                after: Some(customer_label(customer)),
            });
        }
    }
}

fn diff_orders(
    changes: &mut Vec<FieldChange>,
    base: &str,
    before: &InvoiceEditCustomer,
    after: &InvoiceEditCustomer,
    order_identity: &HashMap<Uuid, Uuid>,
) {
    let before_by_id: HashMap<Uuid, &InvoiceEditOrder> = before
        .orders
        .iter()
        .map(|o| (o.original_order_id, o))
        .collect();
    let after_by_id: HashMap<Uuid, &InvoiceEditOrder> = after
        .orders
        .iter()
        .map(|o| {
            (
                order_identity
                    .get(&o.original_order_id)
                    .copied()
                    .unwrap_or(o.original_order_id),
                o,
            )
        })
        .collect();

    for (id, order) in &before_by_id {
        let Some(updated) = after_by_id.get(id) else {
            changes.push(FieldChange {
                path: format!("{base}.orders[{id}]"),
                label: "Garment".into(),
                before: Some(order_label(order)),
                after: None,
            });
            continue;
        };
        order_changes(changes, &format!("{base}.orders[{id}]"), order, updated);
    }

    for (id, order) in &after_by_id {
        if !before_by_id.contains_key(id) {
            changes.push(FieldChange {
                path: format!("{base}.orders[{id}]"),
                label: "Garment".into(),
                before: None,
                after: Some(order_label(order)),
            });
        }
    }
}

fn order_changes(
    changes: &mut Vec<FieldChange>,
    path: &str,
    before: &InvoiceEditOrder,
    after: &InvoiceEditOrder,
) {
    change(
        changes,
        format!("{path}.materialSource"),
        "Material source",
        Some(before.material_source.as_str()),
        Some(after.material_source.as_str()),
    );
    change(
        changes,
        format!("{path}.material"),
        "Material",
        text(&before.material_name).as_deref(),
        text(&after.material_name).as_deref(),
    );
    change(
        changes,
        format!("{path}.customerMaterialDescription"),
        "Customer material description",
        opt_str(&before.customer_material_description).as_deref(),
        opt_str(&after.customer_material_description).as_deref(),
    );
    change(
        changes,
        format!("{path}.materialAmount"),
        "Material amount",
        num(before.material_amount).as_deref(),
        num(after.material_amount).as_deref(),
    );
    change(
        changes,
        format!("{path}.productionLocation"),
        "Production location",
        opt_str(&before.production_location_name).as_deref(),
        opt_str(&after.production_location_name).as_deref(),
    );
    change(
        changes,
        format!("{path}.materialLocation"),
        "Material source location",
        opt_str(&before.material_location_name).as_deref(),
        opt_str(&after.material_location_name).as_deref(),
    );
    change(
        changes,
        format!("{path}.basePrice"),
        "Base price",
        num(before.base_price).as_deref(),
        num(after.base_price).as_deref(),
    );
    change(
        changes,
        format!("{path}.price"),
        "Price",
        num(before.price).as_deref(),
        num(after.price).as_deref(),
    );
    change(
        changes,
        format!("{path}.urgent"),
        "Urgent",
        bool_str(before.is_urgent).as_deref(),
        bool_str(after.is_urgent).as_deref(),
    );
    change(
        changes,
        format!("{path}.urgentCharge"),
        "Urgent charge",
        num(before.urgent_charge).as_deref(),
        num(after.urgent_charge).as_deref(),
    );
    for (field, label) in [
        ("thobeType", "Thobe type"),
        ("fPocket", "Front pocket"),
        ("sPocket", "Side pocket"),
        ("collar", "Collar"),
        ("sleeve", "Sleeve"),
        ("patti", "Patti"),
        ("emd", "EMD"),
        ("moreDetails", "Notes"),
    ] {
        change(
            changes,
            format!("{path}.{field}"),
            label,
            opt_str(&design_slot(before, field)).as_deref(),
            opt_str(&design_slot(after, field)).as_deref(),
        );
    }
}

fn design_slot(order: &InvoiceEditOrder, field: &str) -> Option<String> {
    match field {
        "thobeType" => order.thobe_type.clone(),
        "fPocket" => order.f_pocket.clone(),
        "sPocket" => order.s_pocket.clone(),
        "collar" => order.collar.clone(),
        "sleeve" => order.sleeve.clone(),
        "patti" => order.patti.clone(),
        "emd" => order.emd.clone(),
        _ => order.more_details.clone(),
    }
}

fn diff_products(
    changes: &mut Vec<FieldChange>,
    before: &InvoiceEdit,
    after: &InvoiceEdit,
    identity: &HashMap<Uuid, Uuid>,
) {
    let before_by_id: HashMap<Uuid, &InvoiceEditProductLine> = before
        .products
        .iter()
        .map(|line| (line.original_item_id, line))
        .collect();
    let after_by_id: HashMap<Uuid, &InvoiceEditProductLine> = after
        .products
        .iter()
        .map(|line| {
            (
                identity
                    .get(&line.original_item_id)
                    .copied()
                    .unwrap_or(line.original_item_id),
                line,
            )
        })
        .collect();

    for (id, line) in &before_by_id {
        let path = format!("products[{id}]");
        let Some(updated) = after_by_id.get(id) else {
            changes.push(FieldChange {
                path,
                label: "Product".into(),
                before: Some(line.product_name.clone()),
                after: None,
            });
            continue;
        };
        change(
            changes,
            format!("{path}.description"),
            "Description",
            text(&line.product_name).as_deref(),
            text(&updated.product_name).as_deref(),
        );
        change(
            changes,
            format!("{path}.quantity"),
            "Quantity",
            num(line.quantity).as_deref(),
            num(updated.quantity).as_deref(),
        );
        change(
            changes,
            format!("{path}.unitPrice"),
            "Unit price",
            num(line.unit_price).as_deref(),
            num(updated.unit_price).as_deref(),
        );
        change(
            changes,
            format!("{path}.location"),
            "Location",
            opt_str(&line.branch_name).as_deref(),
            opt_str(&updated.branch_name).as_deref(),
        );
    }

    for (id, line) in &after_by_id {
        if !before_by_id.contains_key(id) {
            changes.push(FieldChange {
                path: format!("products[{id}]"),
                label: "Product".into(),
                before: None,
                after: Some(line.product_name.clone()),
            });
        }
    }
}

fn diff_materials(
    changes: &mut Vec<FieldChange>,
    before: &InvoiceEdit,
    after: &InvoiceEdit,
    identity: &HashMap<Uuid, Uuid>,
) {
    let before_by_id: HashMap<Uuid, &InvoiceEditMaterialLine> = before
        .materials
        .iter()
        .map(|line| (line.original_item_id, line))
        .collect();
    let after_by_id: HashMap<Uuid, &InvoiceEditMaterialLine> = after
        .materials
        .iter()
        .map(|line| {
            (
                identity
                    .get(&line.original_item_id)
                    .copied()
                    .unwrap_or(line.original_item_id),
                line,
            )
        })
        .collect();

    for (id, line) in &before_by_id {
        let path = format!("materials[{id}]");
        let Some(updated) = after_by_id.get(id) else {
            changes.push(FieldChange {
                path,
                label: "Material".into(),
                before: Some(line.material_name.clone()),
                after: None,
            });
            continue;
        };
        change(
            changes,
            format!("{path}.description"),
            "Description",
            text(&line.material_name).as_deref(),
            text(&updated.material_name).as_deref(),
        );
        change(
            changes,
            format!("{path}.quantity"),
            "Quantity",
            num(line.quantity).as_deref(),
            num(updated.quantity).as_deref(),
        );
        change(
            changes,
            format!("{path}.unitPrice"),
            "Unit price",
            num(line.unit_price).as_deref(),
            num(updated.unit_price).as_deref(),
        );
        change(
            changes,
            format!("{path}.location"),
            "Location",
            opt_str(&line.branch_name).as_deref(),
            opt_str(&updated.branch_name).as_deref(),
        );
    }

    for (id, line) in &after_by_id {
        if !before_by_id.contains_key(id) {
            changes.push(FieldChange {
                path: format!("materials[{id}]"),
                label: "Material".into(),
                before: None,
                after: Some(line.material_name.clone()),
            });
        }
    }
}

fn diff_gift_cards(changes: &mut Vec<FieldChange>, before: &InvoiceEdit, after: &InvoiceEdit) {
    let before_by_code: HashMap<&str, _> = before
        .gift_cards
        .iter()
        .map(|card| (card.code.as_str(), card))
        .collect();
    let after_by_code: HashMap<&str, _> = after
        .gift_cards
        .iter()
        .map(|card| (card.code.as_str(), card))
        .collect();

    for (code, card) in &before_by_code {
        let path = format!("giftCards[{code}]");
        let Some(updated) = after_by_code.get(code) else {
            changes.push(FieldChange {
                path,
                label: "Gift card".into(),
                before: gift_card_label(card.code.as_str(), card.amount),
                after: None,
            });
            continue;
        };
        change(
            changes,
            format!("{path}.amount"),
            "Gift card amount",
            num(card.amount).as_deref(),
            num(updated.amount).as_deref(),
        );
        change(
            changes,
            format!("{path}.boughtFor"),
            "Bought for",
            opt_str(&card.bought_for).as_deref(),
            opt_str(&updated.bought_for).as_deref(),
        );
        change(
            changes,
            format!("{path}.recipientPhone"),
            "Recipient phone",
            opt_str(&card.recipient_phone).as_deref(),
            opt_str(&updated.recipient_phone).as_deref(),
        );
        change(
            changes,
            format!("{path}.expiresOn"),
            "Expires on",
            opt_date_str(&card.expires_on).as_deref(),
            opt_date_str(&updated.expires_on).as_deref(),
        );
    }

    for (code, card) in &after_by_code {
        if !before_by_code.contains_key(code) {
            changes.push(FieldChange {
                path: format!("giftCards[{code}]"),
                label: "Gift card".into(),
                before: None,
                after: gift_card_label(card.code.as_str(), card.amount),
            });
        }
    }
}

fn diff_redemptions(changes: &mut Vec<FieldChange>, before: &InvoiceEdit, after: &InvoiceEdit) {
    let before_by_code: HashMap<&str, _> = before
        .gift_card_redemptions
        .iter()
        .map(|redemption| (redemption.code.as_str(), redemption))
        .collect();
    let after_by_code: HashMap<&str, _> = after
        .gift_card_redemptions
        .iter()
        .map(|redemption| (redemption.code.as_str(), redemption))
        .collect();

    for (code, redemption) in &before_by_code {
        let path = format!("redemptions[{code}]");
        let Some(updated) = after_by_code.get(code) else {
            changes.push(FieldChange {
                path,
                label: "Gift card redeemed".into(),
                before: num(redemption.amount),
                after: None,
            });
            continue;
        };
        change(
            changes,
            format!("{path}.amount"),
            "Redeemed amount",
            num(redemption.amount).as_deref(),
            num(updated.amount).as_deref(),
        );
    }

    for (code, redemption) in &after_by_code {
        if !before_by_code.contains_key(code) {
            changes.push(FieldChange {
                path: format!("redemptions[{code}]"),
                label: "Gift card redeemed".into(),
                before: None,
                after: num(redemption.amount),
            });
        }
    }
}

fn measurement_changes(
    base: &str,
    before: &CreateMeasurementInput,
    after: &CreateMeasurementInput,
) -> Vec<FieldChange> {
    let fields: [(&str, &str, Option<String>, Option<String>); 30] = [
        (
            "date",
            "Date",
            opt_date_str(&Some(before.date)),
            opt_date_str(&Some(after.date)),
        ),
        (
            "type",
            "Type",
            opt_str(&before.r#type),
            opt_str(&after.r#type),
        ),
        ("fit", "Fit", opt_str(&before.fit), opt_str(&after.fit)),
        (
            "frontHeight",
            "Front height",
            opt_num(&before.front_height),
            opt_num(&after.front_height),
        ),
        (
            "backHeight",
            "Back height",
            opt_num(&before.back_height),
            opt_num(&after.back_height),
        ),
        (
            "chest",
            "Chest",
            opt_num(&before.chest),
            opt_num(&after.chest),
        ),
        (
            "waist",
            "Waist",
            opt_num(&before.waist),
            opt_num(&after.waist),
        ),
        ("hip", "Hip", opt_num(&before.hip), opt_num(&after.hip)),
        (
            "shoulder",
            "Shoulder",
            opt_num(&before.shoulder),
            opt_num(&after.shoulder),
        ),
        (
            "shoulderDown",
            "Shoulder down",
            opt_num(&before.shoulder_down),
            opt_num(&after.shoulder_down),
        ),
        (
            "sleeveLength",
            "Sleeve length",
            opt_num(&before.sleeve_length),
            opt_num(&after.sleeve_length),
        ),
        (
            "neckSize",
            "Neck size",
            opt_num(&before.neck_size),
            opt_num(&after.neck_size),
        ),
        (
            "openHand",
            "Open hand",
            opt_num(&before.open_hand),
            opt_num(&after.open_hand),
        ),
        (
            "chestUp",
            "Chest up",
            opt_num(&before.chest_up),
            opt_num(&after.chest_up),
        ),
        (
            "cuffWidth",
            "Cuff width",
            opt_num(&before.cuff_width),
            opt_num(&after.cuff_width),
        ),
        (
            "cuffSize",
            "Cuff size",
            opt_num(&before.cuff_size),
            opt_num(&after.cuff_size),
        ),
        (
            "neckWidth",
            "Neck width",
            opt_num(&before.neck_width),
            opt_num(&after.neck_width),
        ),
        (
            "armhole",
            "Armhole",
            opt_num(&before.armhole),
            opt_num(&after.armhole),
        ),
        (
            "foWidth",
            "FO width",
            opt_num(&before.fo_width),
            opt_num(&after.fo_width),
        ),
        ("fo", "FO", opt_num(&before.fo), opt_num(&after.fo)),
        (
            "bottom",
            "Bottom",
            opt_num(&before.bottom),
            opt_num(&after.bottom),
        ),
        (
            "bottomFold",
            "Bottom fold",
            opt_num(&before.bottom_fold),
            opt_num(&after.bottom_fold),
        ),
        (
            "fullBody",
            "Full body",
            opt_num(&before.full_body),
            opt_num(&after.full_body),
        ),
        (
            "sleeveHalf",
            "Sleeve half",
            opt_num(&before.sleeve_half),
            opt_num(&after.sleeve_half),
        ),
        (
            "openFold",
            "Open fold",
            opt_num(&before.open_fold),
            opt_num(&after.open_fold),
        ),
        (
            "frontPocketLength",
            "Front pocket length",
            opt_num(&before.front_pocket_length),
            opt_num(&after.front_pocket_length),
        ),
        (
            "frontPocketLengthByWidth",
            "Front pocket L×W",
            opt_str(&before.front_pocket_length_by_width),
            opt_str(&after.front_pocket_length_by_width),
        ),
        (
            "sidePocket",
            "Side pocket",
            opt_num(&before.side_pocket),
            opt_num(&after.side_pocket),
        ),
        (
            "sidePocketLengthByWidth",
            "Side pocket L×W",
            opt_str(&before.side_pocket_length_by_width),
            opt_str(&after.side_pocket_length_by_width),
        ),
        (
            "mobilePocketLengthByWidth",
            "Mobile pocket L×W",
            opt_str(&before.mobile_pocket_length_by_width),
            opt_str(&after.mobile_pocket_length_by_width),
        ),
    ];

    let mut changes = Vec::new();
    for (field, label, before_value, after_value) in fields {
        change(
            &mut changes,
            format!("{base}.{field}"),
            label,
            before_value.as_deref(),
            after_value.as_deref(),
        );
    }
    changes
}

fn change(
    changes: &mut Vec<FieldChange>,
    path: impl AsRef<str>,
    label: &str,
    before: Option<&str>,
    after: Option<&str>,
) {
    if before == after {
        return;
    }
    changes.push(FieldChange {
        path: path.as_ref().to_owned(),
        label: label.into(),
        before: before.map(str::to_owned),
        after: after.map(str::to_owned),
    });
}

fn customer_label(customer: &InvoiceEditCustomer) -> String {
    format!(
        "{} ({})",
        customer.customer_name, customer.customer_mobile_no
    )
}

fn order_label(order: &InvoiceEditOrder) -> String {
    if order.material_name.is_empty() {
        order.material_source.clone()
    } else {
        order.material_name.clone()
    }
}

fn gift_card_label(code: &str, amount: f64) -> Option<String> {
    Some(format!("{code} ({})", num(amount).unwrap_or_default()))
}

fn opt_str(value: &Option<String>) -> Option<String> {
    value.clone().filter(|value| !value.is_empty())
}

fn text(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn num(value: f64) -> Option<String> {
    Some(format!("{value:.2}"))
}

fn opt_num(value: &Option<f64>) -> Option<String> {
    value.map(|value| format!("{value:.2}"))
}

fn bool_str(value: bool) -> Option<String> {
    Some(if value { "Yes" } else { "No" }.into())
}

fn opt_date_str(value: &Option<NaiveDate>) -> Option<String> {
    value.map(|date| date.to_string())
}

/// Payments already carry their own actor and timestamp; this helper lets the
/// history service build entries straight from the ledger row.
pub fn payment_entry(payment: InvoicePayment) -> InvoiceHistoryEntry {
    InvoiceHistoryEntry::Payment {
        id: payment.id,
        at: payment.paid_at,
        actor: payment.recorded_by,
        amount: payment.amount,
        payment_type: payment.payment_type,
        order_id: payment.order_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::invoices::types::{
        InvoiceEditCustomer, InvoiceEditGiftCardLine, InvoiceEditRedemption,
    };
    use serde_json::json;

    fn measurement() -> CreateMeasurementInput {
        serde_json::from_value(json!({"date":"2026-01-01","chest":40.0})).unwrap()
    }

    fn order(id: Uuid, price: f64) -> InvoiceEditOrder {
        InvoiceEditOrder {
            original_order_id: id,
            is_urgent: false,
            base_price: price,
            urgent_charge: 0.0,
            material_source: "customer".into(),
            material_id: None,
            customer_material_description: Some("Customer cotton".into()),
            material_name: "Customer cotton".into(),
            material_unit: "meters".into(),
            material_amount: 3.0,
            production_location_id: None,
            production_location_name: None,
            material_location_id: None,
            material_location_name: None,
            stock_quantity: None,
            price,
            thobe_type: None,
            f_pocket: None,
            s_pocket: None,
            collar: None,
            sleeve: None,
            patti: None,
            emd: None,
            more_details: None,
        }
    }

    fn customer(id: Uuid, orders: Vec<InvoiceEditOrder>) -> InvoiceEditCustomer {
        InvoiceEditCustomer {
            existing_customer_id: id,
            customer_number: 1,
            customer_name: "Buyer".into(),
            customer_mobile_no: "33112233".into(),
            customer_address: None,
            measurement_id: Some(Uuid::new_v4()),
            measurement: measurement(),
            orders,
        }
    }

    fn edit(customers: Vec<InvoiceEditCustomer>) -> InvoiceEdit {
        InvoiceEdit {
            delivery_charge: 0.0,
            issuing_branch_id: None,
            issuing_branch_name: None,
            vat_rate: 0.1,
            urgent_charge: 0.0,
            collection_method: "pickup".into(),
            id: Uuid::new_v4(),
            invoice_number: 1,
            date: Utc::now(),
            target_date: None,
            branch_id: None,
            branch_name: None,
            discount: 0.0,
            discount_unit: "amount".into(),
            payments: vec![],
            customer_id: None,
            customers,
            products: vec![],
            materials: vec![],
            gift_cards: vec![],
            gift_card_redemptions: vec![],
        }
    }

    #[test]
    fn identical_states_produce_no_changes() {
        let customer_id = Uuid::new_v4();
        let order_id = Uuid::new_v4();
        let before = edit(vec![customer(customer_id, vec![order(order_id, 100.0)])]);
        let after = edit(vec![customer(customer_id, vec![order(order_id, 100.0)])]);
        let changes = diff_invoice_edits(&before, &after, &HashMap::new(), &HashMap::new());
        assert!(changes.is_empty());
    }

    #[test]
    fn header_changes_are_recorded() {
        let before = edit(vec![]);
        let mut after = edit(vec![]);
        after.discount = 5.0;
        after.collection_method = "delivery".into();
        after.delivery_charge = 3.0;
        let changes = diff_invoice_edits(&before, &after, &HashMap::new(), &HashMap::new());
        let paths: Vec<&str> = changes.iter().map(|c| c.path.as_str()).collect();
        assert!(paths.contains(&"header.discount"));
        assert!(paths.contains(&"header.collectionMethod"));
        assert!(paths.contains(&"header.deliveryCharge"));
        let discount = changes
            .iter()
            .find(|c| c.path == "header.discount")
            .unwrap();
        assert_eq!(discount.before.as_deref(), Some("0.00"));
        assert_eq!(discount.after.as_deref(), Some("5.00"));
    }

    #[test]
    fn kept_order_matches_by_original_id_even_when_rebuilt_with_a_new_id() {
        let customer_id = Uuid::new_v4();
        let old_id = Uuid::new_v4();
        let new_id = Uuid::new_v4();
        let before = edit(vec![customer(customer_id, vec![order(old_id, 100.0)])]);
        let after = edit(vec![customer(customer_id, vec![order(new_id, 120.0)])]);
        let mut identity = HashMap::new();
        identity.insert(new_id, old_id);
        let changes = diff_invoice_edits(&before, &after, &identity, &HashMap::new());
        // A price change on the same garment, not an add/remove pair.
        let price = changes.iter().find(|c| c.label == "Price").unwrap();
        assert_eq!(price.before.as_deref(), Some("100.00"));
        assert_eq!(price.after.as_deref(), Some("120.00"));
        assert!(!changes.iter().any(|c| c.label == "Garment"));
    }

    #[test]
    fn removed_and_added_garments_are_recorded() {
        let customer_id = Uuid::new_v4();
        let removed = Uuid::new_v4();
        let added = Uuid::new_v4();
        let before = edit(vec![customer(customer_id, vec![order(removed, 100.0)])]);
        let after = edit(vec![customer(customer_id, vec![order(added, 90.0)])]);
        let changes = diff_invoice_edits(&before, &after, &HashMap::new(), &HashMap::new());
        assert_eq!(changes.len(), 2);
        assert!(changes
            .iter()
            .any(|c| c.label == "Garment" && c.after.is_none()));
        assert!(changes
            .iter()
            .any(|c| c.label == "Garment" && c.before.is_none()));
    }

    #[test]
    fn measurement_changes_are_recorded() {
        let customer_id = Uuid::new_v4();
        let order_id = Uuid::new_v4();
        let before = edit(vec![customer(customer_id, vec![order(order_id, 100.0)])]);
        let mut after_customer = customer(customer_id, vec![order(order_id, 100.0)]);
        after_customer.measurement =
            serde_json::from_value(json!({"date":"2026-01-01","chest":42.0})).unwrap();
        let after = edit(vec![after_customer]);
        let changes = diff_invoice_edits(&before, &after, &HashMap::new(), &HashMap::new());
        let chest = changes.iter().find(|c| c.path.ends_with(".chest")).unwrap();
        assert_eq!(chest.before.as_deref(), Some("40.00"));
        assert_eq!(chest.after.as_deref(), Some("42.00"));
    }

    #[test]
    fn gift_card_and_redemption_changes_are_recorded() {
        let mut before = edit(vec![]);
        before.gift_cards.push(InvoiceEditGiftCardLine {
            code: "GC-1".into(),
            amount: 50.0,
            bought_for: None,
            recipient_phone: None,
            expires_on: None,
        });
        before.gift_card_redemptions.push(InvoiceEditRedemption {
            code: "GC-2".into(),
            amount: 20.0,
            taxed_at_issue: true,
        });
        let mut after = edit(vec![]);
        after.gift_cards.push(InvoiceEditGiftCardLine {
            code: "GC-1".into(),
            amount: 75.0,
            bought_for: None,
            recipient_phone: None,
            expires_on: None,
        });
        let changes = diff_invoice_edits(&before, &after, &HashMap::new(), &HashMap::new());
        assert!(changes.iter().any(|c| c.path == "giftCards[GC-1].amount"));
        assert!(changes
            .iter()
            .any(|c| c.path == "redemptions[GC-2]" && c.after.is_none()));
    }
}
