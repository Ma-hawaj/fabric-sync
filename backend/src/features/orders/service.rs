use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{
        CreateRepairInput, OrderListItem, OrderRepair, OrderRow, OrderStageEntry, PaymentType,
        ProgressRow, RepairRow, RepairStatus, SetStageInput, StageRow, StageStatus,
        UpdateOrderInput, UpdateRepairInput,
    },
};

// A delivery stage only matters when the garment actually has to move. Produced
// at the branch the customer collects from — or with no production location
// recorded yet — there is nothing to deliver, so the stage is reported as not
// applicable instead of sitting there unfinished forever.
fn stage_applies(
    requires_delivery: bool,
    production_location_id: Option<Uuid>,
    receiving_location_id: Option<Uuid>,
) -> bool {
    if !requires_delivery {
        return true;
    }

    match (production_location_id, receiving_location_id) {
        (Some(production), Some(receiving)) => production != receiving,
        _ => false,
    }
}

// Overlays the recorded actions onto the live catalog for one pass — the
// original build, or one repair's rework. `progress` is expected to be filtered
// to that pass already.
//
// A retired stage stays on the checklist if it was acted on before being
// retired, so an order's history doesn't rewrite itself when staff tidy the
// catalog. Catalog order (sort_order, then name) is preserved.
fn assemble_stages(
    catalog: &[StageRow],
    progress: &[ProgressRow],
    production_location_id: Option<Uuid>,
    receiving_location_id: Option<Uuid>,
) -> Vec<OrderStageEntry> {
    catalog
        .iter()
        .filter_map(|stage| {
            let recorded = progress.iter().find(|row| row.stage_id == stage.id);

            if !stage.is_active && recorded.is_none() {
                return None;
            }

            Some(OrderStageEntry {
                stage_id: stage.id,
                name: stage.name.clone(),
                sort_order: stage.sort_order,
                requires_delivery: stage.requires_delivery,
                applicable: stage_applies(
                    stage.requires_delivery,
                    production_location_id,
                    receiving_location_id,
                ),
                status: recorded
                    .map(|row| row.status.clone())
                    .unwrap_or_else(|| StageStatus::Pending.as_str().to_string()),
                completed_at: recorded.map(|row| row.completed_at),
                location_id: recorded.and_then(|row| row.location_id),
                location: recorded.and_then(|row| row.location.clone()),
                notes: recorded.and_then(|row| row.notes.clone()),
            })
        })
        .collect()
}

// The first applicable stage nobody has acted on yet. `None` means the pass is
// finished — every stage is done, skipped, or doesn't apply.
fn current_stage_name(stages: &[OrderStageEntry]) -> Option<String> {
    stages
        .iter()
        .find(|entry| entry.applicable && entry.status == StageStatus::Pending.as_str())
        .map(|entry| entry.name.clone())
}

// Stamped when a repair is completed and cleared when it moves anywhere else,
// so the timestamp can never describe a repair that is open again.
fn repair_completion_time(status: RepairStatus, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match status {
        RepairStatus::Completed => Some(now),
        _ => None,
    }
}

fn normalized_reason(reason: &str) -> Result<String, AppError> {
    let reason = reason.trim();

    if reason.is_empty() {
        return Err(AppError::BadRequest("a repair needs a reason".to_string()));
    }

    Ok(reason.to_string())
}

fn validate_charge(charge: f64) -> Result<(), AppError> {
    if charge < 0.0 {
        return Err(AppError::BadRequest(
            "a repair charge cannot be negative".to_string(),
        ));
    }

    Ok(())
}

// Completing a delivery has to say where the garment went, otherwise the stage
// records a move with no destination. Skipping it, or completing a stage that
// needs no delivery, carries no location.
fn validate_delivery_location(
    requires_delivery: bool,
    applicable: bool,
    status: StageStatus,
    location_id: Option<Uuid>,
) -> Result<(), AppError> {
    if requires_delivery && applicable && status == StageStatus::Done && location_id.is_none() {
        return Err(AppError::BadRequest(
            "completing a delivery stage needs a destination location".to_string(),
        ));
    }

    Ok(())
}

fn assemble_order(
    row: OrderRow,
    catalog: &[StageRow],
    progress: &[ProgressRow],
    repairs: &[RepairRow],
) -> OrderListItem {
    let build_progress: Vec<ProgressRow> = progress
        .iter()
        .filter(|entry| entry.order_id == row.id && entry.repair_id.is_none())
        .cloned()
        .collect();

    let stages = assemble_stages(
        catalog,
        &build_progress,
        row.production_location_id,
        row.receiving_location_id,
    );
    let current_stage = current_stage_name(&stages);

    let repairs = repairs
        .iter()
        .filter(|repair| repair.order_id == row.id)
        .map(|repair| {
            let repair_progress: Vec<ProgressRow> = progress
                .iter()
                .filter(|entry| entry.repair_id == Some(repair.id))
                .cloned()
                .collect();

            let stages = assemble_stages(
                catalog,
                &repair_progress,
                row.production_location_id,
                row.receiving_location_id,
            );

            OrderRepair {
                id: repair.id,
                reason: repair.reason.clone(),
                reported_on: repair.reported_on,
                charge: repair.charge,
                status: repair.status.clone(),
                completed_at: repair.completed_at,
                notes: repair.notes.clone(),
                current_stage: current_stage_name(&stages),
                stages,
            }
        })
        .collect();

    OrderListItem {
        id: row.id,
        invoice_id: row.invoice_id,
        invoice_date: row.invoice_date,
        measurement_id: row.measurement_id,
        customer_name: row.customer_name,
        customer_mobile: row.customer_mobile,
        material: row.material,
        material_amount: row.material_amount,
        price: row.price,
        status: row.status,
        production_location_id: row.production_location_id,
        production_location: row.production_location,
        receiving_location_id: row.receiving_location_id,
        receiving_location: row.receiving_location,
        stages,
        current_stage,
        repairs,
        invoice_total_price: row.invoice_total_price,
        invoice_amount_paid: row.invoice_amount_paid,
        invoice_payment_status: row.invoice_payment_status,
        invoice_advance_amount: row.invoice_advance_amount,
        invoice_advance_payment_type: row.invoice_advance_payment_type,
        invoice_final_payment_type: row.invoice_final_payment_type,
    }
}

// The checklist is derived rather than stored, so it takes three small reads
// alongside the order query. Assembling in Rust keeps that logic in pure
// functions the tests below can reach, rather than a lateral join nothing can
// exercise without a database.
async fn assemble(state: &AppState, rows: Vec<OrderRow>) -> Result<Vec<OrderListItem>, AppError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let order_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let catalog = repository::list_stage_catalog(state).await?;
    let progress = repository::list_progress(state, &order_ids).await?;
    let repairs = repository::list_repairs(state, &order_ids).await?;

    Ok(rows
        .into_iter()
        .map(|row| assemble_order(row, &catalog, &progress, &repairs))
        .collect())
}

async fn load_order(state: &AppState, order_id: Uuid) -> Result<OrderListItem, AppError> {
    let row = repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    Ok(assemble(state, vec![row])
        .await?
        .pop()
        .expect("one row in, one row out"))
}

pub async fn list_orders(state: &AppState) -> Result<Vec<OrderListItem>, AppError> {
    let rows = repository::list_orders(state).await?;

    assemble(state, rows).await
}

/// Marks an order received and, once every order on its invoice has been
/// received, settles the invoice's remaining balance in full via
/// `final_payment_type`.
///
/// Deliberately not gated on the production checklist: staff hand a garment
/// over when it is ready, so the current stage is shown alongside rather than
/// blocking the counter.
pub async fn receive_order(
    state: &AppState,
    order_id: Uuid,
    final_payment_type: PaymentType,
) -> Result<OrderListItem, AppError> {
    let mut tx = state.db().begin().await?;

    let invoice_id = repository::mark_received(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    if repository::invoice_fully_received(&mut tx, invoice_id).await? {
        repository::mark_invoice_paid(&mut tx, invoice_id, final_payment_type).await?;
    }

    tx.commit().await?;

    load_order(state, order_id).await
}

pub async fn update_order(
    state: &AppState,
    order_id: Uuid,
    input: UpdateOrderInput,
) -> Result<OrderListItem, AppError> {
    repository::update_order(state, order_id, input.production_location_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    load_order(state, order_id).await
}

/// Records one checklist entry. `Pending` deletes the entry rather than storing
/// a third state, which is how a stage ticked by mistake is undone.
pub async fn set_stage(
    state: &AppState,
    order_id: Uuid,
    stage_id: Uuid,
    input: SetStageInput,
) -> Result<OrderListItem, AppError> {
    let order = repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    let catalog = repository::list_stage_catalog(state).await?;
    let stage = catalog
        .iter()
        .find(|stage| stage.id == stage_id)
        .ok_or_else(|| AppError::NotFound(format!("order stage {stage_id} not found")))?;

    if let Some(repair_id) = input.repair_id {
        if !repository::repair_belongs_to_order(state, repair_id, order_id).await? {
            return Err(AppError::NotFound(format!(
                "repair {repair_id} not found on order {order_id}"
            )));
        }
    }

    validate_delivery_location(
        stage.requires_delivery,
        stage_applies(
            stage.requires_delivery,
            order.production_location_id,
            order.receiving_location_id,
        ),
        input.status,
        input.location_id,
    )?;

    let mut tx = state.db().begin().await?;

    if input.status == StageStatus::Pending {
        repository::clear_stage(&mut tx, order_id, input.repair_id, stage_id).await?;
    } else {
        repository::set_stage(
            &mut tx,
            order_id,
            input.repair_id,
            stage_id,
            input.status.as_str(),
            input.location_id,
            input.notes.as_deref(),
        )
        .await?;

        // Acting on a repair's checklist is what starts it; staff shouldn't
        // have to set the status separately before getting to work.
        if let Some(repair_id) = input.repair_id {
            repository::start_repair(&mut tx, repair_id).await?;
        }
    }

    tx.commit().await?;

    load_order(state, order_id).await
}

pub async fn create_repair(
    state: &AppState,
    order_id: Uuid,
    input: CreateRepairInput,
) -> Result<OrderListItem, AppError> {
    if !repository::order_exists(state, order_id).await? {
        return Err(AppError::NotFound(format!("order {order_id} not found")));
    }

    let reason = normalized_reason(&input.reason)?;
    validate_charge(input.charge)?;

    repository::create_repair(
        state,
        order_id,
        &reason,
        input.charge,
        input.notes.as_deref(),
    )
    .await?;

    load_order(state, order_id).await
}

pub async fn update_repair(
    state: &AppState,
    order_id: Uuid,
    repair_id: Uuid,
    input: UpdateRepairInput,
) -> Result<OrderListItem, AppError> {
    if !repository::repair_belongs_to_order(state, repair_id, order_id).await? {
        return Err(AppError::NotFound(format!(
            "repair {repair_id} not found on order {order_id}"
        )));
    }

    let reason = input.reason.as_deref().map(normalized_reason).transpose()?;

    if let Some(charge) = input.charge {
        validate_charge(charge)?;
    }

    let completed_at = input
        .status
        .and_then(|status| repair_completion_time(status, Utc::now()));

    repository::update_repair(
        state,
        repair_id,
        reason.as_deref(),
        input.charge,
        input.status.map(RepairStatus::as_str),
        input.notes.as_deref(),
        completed_at,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("repair {repair_id} not found")))?;

    load_order(state, order_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage(name: &str, sort_order: i32, requires_delivery: bool, is_active: bool) -> StageRow {
        StageRow {
            id: Uuid::from_u128(sort_order as u128),
            name: name.to_string(),
            sort_order,
            requires_delivery,
            is_active,
        }
    }

    fn catalog() -> Vec<StageRow> {
        vec![
            stage("Cutting", 1, false, true),
            stage("Sewing", 2, false, true),
            stage("Finishing", 3, false, true),
            stage("Location delivery", 4, true, true),
        ]
    }

    fn progress(stage_sort_order: i32, status: &str) -> ProgressRow {
        ProgressRow {
            order_id: Uuid::nil(),
            repair_id: None,
            stage_id: Uuid::from_u128(stage_sort_order as u128),
            status: status.to_string(),
            completed_at: Utc::now(),
            location_id: None,
            location: None,
            notes: None,
        }
    }

    fn workshop() -> Uuid {
        Uuid::from_u128(900)
    }

    fn branch() -> Uuid {
        Uuid::from_u128(901)
    }

    #[test]
    fn an_ordinary_stage_always_applies() {
        assert!(stage_applies(false, None, None));
        assert!(stage_applies(false, Some(workshop()), Some(workshop())));
    }

    #[test]
    fn a_delivery_stage_applies_only_when_the_locations_differ() {
        assert!(stage_applies(true, Some(workshop()), Some(branch())));
        assert!(!stage_applies(true, Some(workshop()), Some(workshop())));
    }

    #[test]
    fn a_delivery_stage_does_not_apply_until_both_locations_are_known() {
        assert!(!stage_applies(true, None, Some(branch())));
        assert!(!stage_applies(true, Some(workshop()), None));
        assert!(!stage_applies(true, None, None));
    }

    #[test]
    fn an_untouched_order_reports_every_stage_pending() {
        let stages = assemble_stages(&catalog(), &[], Some(workshop()), Some(branch()));

        assert_eq!(stages.len(), 4);
        assert!(stages.iter().all(|entry| entry.status == "pending"));
        assert_eq!(current_stage_name(&stages).as_deref(), Some("Cutting"));
    }

    #[test]
    fn recorded_stages_are_overlaid_onto_the_catalog_in_order() {
        let stages = assemble_stages(
            &catalog(),
            &[progress(1, "done"), progress(2, "done")],
            Some(workshop()),
            Some(branch()),
        );

        let statuses: Vec<&str> = stages.iter().map(|entry| entry.status.as_str()).collect();
        assert_eq!(statuses, ["done", "done", "pending", "pending"]);
        assert_eq!(current_stage_name(&stages).as_deref(), Some("Finishing"));
    }

    #[test]
    fn a_skipped_stage_does_not_hold_up_the_checklist() {
        let stages = assemble_stages(
            &catalog(),
            &[progress(1, "skipped")],
            Some(workshop()),
            Some(branch()),
        );

        assert_eq!(current_stage_name(&stages).as_deref(), Some("Sewing"));
    }

    #[test]
    fn a_delivery_that_does_not_apply_leaves_the_order_finished() {
        // Produced at the same branch the customer collects from, so there is
        // nothing to deliver and the order is done after Finishing.
        let stages = assemble_stages(
            &catalog(),
            &[
                progress(1, "done"),
                progress(2, "done"),
                progress(3, "done"),
            ],
            Some(workshop()),
            Some(workshop()),
        );

        assert!(!stages[3].applicable);
        assert_eq!(current_stage_name(&stages), None);
    }

    #[test]
    fn a_delivery_that_applies_still_holds_the_order_open() {
        let stages = assemble_stages(
            &catalog(),
            &[
                progress(1, "done"),
                progress(2, "done"),
                progress(3, "done"),
            ],
            Some(workshop()),
            Some(branch()),
        );

        assert!(stages[3].applicable);
        assert_eq!(
            current_stage_name(&stages).as_deref(),
            Some("Location delivery")
        );
    }

    #[test]
    fn a_retired_stage_is_dropped_unless_it_was_already_acted_on() {
        let mut catalog = catalog();
        catalog[1].is_active = false;

        let untouched = assemble_stages(&catalog, &[], Some(workshop()), Some(branch()));
        let names: Vec<&str> = untouched.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["Cutting", "Finishing", "Location delivery"]);

        let recorded = assemble_stages(
            &catalog,
            &[progress(2, "done")],
            Some(workshop()),
            Some(branch()),
        );
        let names: Vec<&str> = recorded.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(
            names,
            ["Cutting", "Sewing", "Finishing", "Location delivery"]
        );
    }

    #[test]
    fn a_completed_repair_is_stamped_and_any_other_status_clears_the_stamp() {
        let now = Utc::now();

        assert_eq!(
            repair_completion_time(RepairStatus::Completed, now),
            Some(now)
        );
        for status in [
            RepairStatus::Open,
            RepairStatus::InProgress,
            RepairStatus::Cancelled,
        ] {
            assert_eq!(repair_completion_time(status, now), None, "{status:?}");
        }
    }

    #[test]
    fn normalized_reason_trims_and_rejects_blanks() {
        assert_eq!(
            normalized_reason("  Sleeve too long \n").unwrap(),
            "Sleeve too long"
        );

        for reason in ["", "   ", "\t\n"] {
            let error = normalized_reason(reason).unwrap_err();
            assert!(matches!(error, AppError::BadRequest(_)), "{reason:?}");
        }
    }

    #[test]
    fn validate_charge_rejects_a_negative_charge() {
        assert!(validate_charge(0.0).is_ok());
        assert!(validate_charge(35.0).is_ok());
        let error = validate_charge(-1.0).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    #[test]
    fn completing_an_applicable_delivery_requires_a_destination() {
        let error = validate_delivery_location(true, true, StageStatus::Done, None).unwrap_err();
        assert!(matches!(error, AppError::BadRequest(_)));

        assert!(validate_delivery_location(true, true, StageStatus::Done, Some(branch())).is_ok());
    }

    #[test]
    fn a_destination_is_not_required_when_there_is_nothing_to_deliver() {
        // Skipping a delivery, a delivery that doesn't apply, and an ordinary
        // stage all carry no location.
        assert!(validate_delivery_location(true, true, StageStatus::Skipped, None).is_ok());
        assert!(validate_delivery_location(true, false, StageStatus::Done, None).is_ok());
        assert!(validate_delivery_location(false, true, StageStatus::Done, None).is_ok());
    }
}
