use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{
    repository,
    types::{
        AssignStageInput, AssignmentRow, CreateRepairInput, OrderListItem, OrderRepair, OrderRow,
        OrderStageEntry, PaymentType, ProgressRow, RepairRow, RepairStatus, SetStageInput,
        StageRow, StageStatus, UpdateOrderInput, UpdateRepairInput,
    },
};
use crate::features::users;

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

// An explicit assignment (via PATCH /orders/:id) always wins. Absent one, a
// material stocked at exactly one usable location is inferred, so staff don't
// have to assign the obvious answer by hand — but a material split across
// several locations is left alone rather than guessed at, since there's
// nothing here to disambiguate it with.
fn effective_production(
    assigned_id: Option<Uuid>,
    assigned_name: Option<&str>,
    material_id: Uuid,
    single_location_materials: &HashMap<Uuid, (Uuid, String)>,
) -> (Option<Uuid>, Option<String>, bool) {
    if let Some(id) = assigned_id {
        return (Some(id), assigned_name.map(str::to_string), false);
    }

    match single_location_materials.get(&material_id) {
        Some((id, name)) => (Some(*id), Some(name.clone()), true),
        None => (None, None, false),
    }
}

// Midnight UTC on the given date, used as the starting point for a pass's
// first stage when there is no earlier stage to chain from. Coarser than a
// real timestamp — the schema has no created_at to draw on — but it's the
// closest thing already in the data (invoice_date for the build, reported_on
// for a repair).
fn date_start(date: NaiveDate) -> DateTime<Utc> {
    date.and_hms_opt(0, 0, 0)
        .expect("midnight is always a valid time")
        .and_utc()
}

// Chains each stage's start to the previous stage's finish, so the checklist
// reads as a timeline without a separate "start" action or column. A stage
// that doesn't apply is transparent to the chain — it never got acted on and
// never will, so it neither takes a start time nor blocks the next one from
// getting one. The chain stops at the first applicable stage still pending:
// that one gets a start (queued since); nothing further down the list does,
// since work hasn't reached it yet.
fn with_start_times(
    mut stages: Vec<OrderStageEntry>,
    pass_started_at: DateTime<Utc>,
) -> Vec<OrderStageEntry> {
    let mut previous_finish = pass_started_at;
    let mut reached_current = false;

    for stage in &mut stages {
        if !stage.applicable || reached_current {
            stage.started_at = None;
            continue;
        }

        stage.started_at = Some(previous_finish);

        match stage.completed_at {
            Some(completed_at) => previous_finish = completed_at,
            None => reached_current = true,
        }
    }

    stages
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
                // Filled in by `with_start_times` once the full pass is
                // assembled; assemble_stages only knows this one stage.
                started_at: None,
                completed_at: recorded.map(|row| row.completed_at),
                location_id: recorded.and_then(|row| row.location_id),
                location: recorded.and_then(|row| row.location.clone()),
                notes: recorded.and_then(|row| row.notes.clone()),
                // Filled in by `with_assignees`; assemble_stages doesn't see
                // assignments at all, since they're independent of progress.
                assignee_id: None,
                assignee_name: None,
            })
        })
        .collect()
}

// Overlays who's assigned onto an already-assembled checklist. Separate from
// assemble_stages because assignment has nothing to do with progress — a
// stage can be assigned whether it's pending, done, or skipped.
fn with_assignees(
    mut stages: Vec<OrderStageEntry>,
    assignments: &[AssignmentRow],
) -> Vec<OrderStageEntry> {
    for stage in &mut stages {
        if let Some(assignment) = assignments
            .iter()
            .find(|assignment| assignment.stage_id == stage.stage_id)
        {
            stage.assignee_id = Some(assignment.assignee_id.clone());
            stage.assignee_name = Some(assignment.assignee_name.clone());
        }
    }

    stages
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
    assignments: &[AssignmentRow],
    repairs: &[RepairRow],
    single_location_materials: &HashMap<Uuid, (Uuid, String)>,
) -> OrderListItem {
    let (production_location_id, production_location, production_location_inferred) =
        effective_production(
            row.production_location_id,
            row.production_location.as_deref(),
            row.material_id,
            single_location_materials,
        );

    let build_progress: Vec<ProgressRow> = progress
        .iter()
        .filter(|entry| entry.order_id == row.id)
        .cloned()
        .collect();
    let build_assignments: Vec<AssignmentRow> = assignments
        .iter()
        .filter(|assignment| assignment.order_id == row.id)
        .cloned()
        .collect();

    let stages = with_assignees(
        with_start_times(
            assemble_stages(
                catalog,
                &build_progress,
                production_location_id,
                row.receiving_location_id,
            ),
            date_start(row.invoice_date),
        ),
        &build_assignments,
    );
    let current_stage = current_stage_name(&stages);

    // A repair is tracked by its own record and status, not a second pass
    // through the checklist — one order, one checklist.
    let repairs = repairs
        .iter()
        .filter(|repair| repair.order_id == row.id)
        .map(|repair| OrderRepair {
            id: repair.id,
            reason: repair.reason.clone(),
            reported_on: repair.reported_on,
            charge: repair.charge,
            status: repair.status.clone(),
            completed_at: repair.completed_at,
            notes: repair.notes.clone(),
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
        production_location_id,
        production_location,
        production_location_inferred,
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

async fn single_location_map(
    state: &AppState,
    material_ids: &[Uuid],
) -> Result<HashMap<Uuid, (Uuid, String)>, AppError> {
    Ok(repository::single_stock_locations(state, material_ids)
        .await?
        .into_iter()
        .map(|(material_id, branch_id, branch_name)| (material_id, (branch_id, branch_name)))
        .collect())
}

// The checklist is derived rather than stored, so it takes a handful of small
// reads alongside the order query. Assembling in Rust keeps that logic in pure
// functions the tests below can reach, rather than a lateral join nothing can
// exercise without a database.
async fn assemble(state: &AppState, rows: Vec<OrderRow>) -> Result<Vec<OrderListItem>, AppError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let order_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let material_ids: Vec<Uuid> = rows.iter().map(|row| row.material_id).collect();
    let catalog = repository::list_stage_catalog(state).await?;
    let progress = repository::list_progress(state, &order_ids).await?;
    let assignments = repository::list_assignments(state, &order_ids).await?;
    let repairs = repository::list_repairs(state, &order_ids).await?;
    let single_location_materials = single_location_map(state, &material_ids).await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            assemble_order(
                row,
                &catalog,
                &progress,
                &assignments,
                &repairs,
                &single_location_materials,
            )
        })
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

    let invoice_settled = repository::invoice_fully_received(&mut tx, invoice_id).await?;
    if invoice_settled {
        repository::mark_invoice_paid(&mut tx, invoice_id, final_payment_type).await?;
    }

    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        invoice_id = %invoice_id,
        invoice_settled,
        "order received"
    );

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

    tracing::info!(
        order_id = %order_id,
        production_location_id = ?input.production_location_id,
        "order production location updated"
    );

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

    let single_location_materials =
        single_location_map(state, std::slice::from_ref(&order.material_id)).await?;
    let (effective_production_id, _, _) = effective_production(
        order.production_location_id,
        order.production_location.as_deref(),
        order.material_id,
        &single_location_materials,
    );

    validate_delivery_location(
        stage.requires_delivery,
        stage_applies(
            stage.requires_delivery,
            effective_production_id,
            order.receiving_location_id,
        ),
        input.status,
        input.location_id,
    )?;

    let mut tx = state.db().begin().await?;

    if input.status == StageStatus::Pending {
        repository::clear_stage(&mut tx, order_id, stage_id).await?;
    } else {
        repository::set_stage(
            &mut tx,
            order_id,
            stage_id,
            input.status.as_str(),
            input.location_id,
            input.notes.as_deref(),
        )
        .await?;
    }

    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        stage_id = %stage_id,
        stage = %stage.name,
        status = input.status.as_str(),
        "order stage updated"
    );

    load_order(state, order_id).await
}

/// Assigns or clears a stage's assignee, independent of `set_stage` — a stage
/// is assignable whether it's pending, done, or skipped. `assignee_name` is
/// resolved here against the (currently mocked) user directory rather than
/// trusted from the client, matching how a location's name is always looked
/// up server-side instead of taken from the request.
pub async fn set_assignee(
    state: &AppState,
    order_id: Uuid,
    stage_id: Uuid,
    input: AssignStageInput,
) -> Result<OrderListItem, AppError> {
    repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    let catalog = repository::list_stage_catalog(state).await?;
    if !catalog.iter().any(|stage| stage.id == stage_id) {
        return Err(AppError::NotFound(format!(
            "order stage {stage_id} not found"
        )));
    }

    match input.assignee_id {
        Some(assignee_id) => {
            let users = users::service::list_users(state).await?;
            let user = users
                .iter()
                .find(|user| user.id == assignee_id)
                .ok_or_else(|| AppError::BadRequest(format!("unknown user {assignee_id}")))?;

            repository::set_assignee(state, order_id, stage_id, &user.id, &user.name).await?;

            tracing::info!(
                order_id = %order_id,
                stage_id = %stage_id,
                assignee_id = %user.id,
                assignee_name = %user.name,
                "order stage assignee set"
            );
        }
        None => {
            repository::clear_assignee(state, order_id, stage_id).await?;

            tracing::info!(
                order_id = %order_id,
                stage_id = %stage_id,
                "order stage assignee cleared"
            );
        }
    }

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

    tracing::info!(
        order_id = %order_id,
        reason = %reason,
        charge = input.charge,
        "order repair opened"
    );

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

    tracing::info!(
        order_id = %order_id,
        repair_id = %repair_id,
        status = ?input.status,
        "order repair updated"
    );

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
            stage_id: Uuid::from_u128(stage_sort_order as u128),
            status: status.to_string(),
            completed_at: Utc::now(),
            location_id: None,
            location: None,
            notes: None,
        }
    }

    fn assignment(stage_sort_order: i32, assignee_id: &str, assignee_name: &str) -> AssignmentRow {
        AssignmentRow {
            order_id: Uuid::nil(),
            stage_id: Uuid::from_u128(stage_sort_order as u128),
            assignee_id: assignee_id.to_string(),
            assignee_name: assignee_name.to_string(),
        }
    }

    fn workshop() -> Uuid {
        Uuid::from_u128(900)
    }

    fn branch() -> Uuid {
        Uuid::from_u128(901)
    }

    fn cotton() -> Uuid {
        Uuid::from_u128(902)
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

    #[test]
    fn an_explicit_assignment_always_wins_over_inference() {
        let mut single_location = HashMap::new();
        single_location.insert(cotton(), (workshop(), "Central Workshop".to_string()));

        let (id, name, inferred) = effective_production(
            Some(branch()),
            Some("Riyadh Main Branch"),
            cotton(),
            &single_location,
        );

        assert_eq!(id, Some(branch()));
        assert_eq!(name.as_deref(), Some("Riyadh Main Branch"));
        assert!(!inferred);
    }

    #[test]
    fn a_material_stocked_at_exactly_one_location_is_inferred() {
        let mut single_location = HashMap::new();
        single_location.insert(cotton(), (workshop(), "Central Workshop".to_string()));

        let (id, name, inferred) = effective_production(None, None, cotton(), &single_location);

        assert_eq!(id, Some(workshop()));
        assert_eq!(name.as_deref(), Some("Central Workshop"));
        assert!(inferred);
    }

    #[test]
    fn a_material_split_across_locations_is_left_for_staff_to_assign() {
        // A material stocked at more than one location never enters the map in
        // the first place (repository::single_stock_locations filters it out),
        // so an absent entry is exactly what an ambiguous material looks like.
        let single_location = HashMap::new();

        let (id, name, inferred) = effective_production(None, None, cotton(), &single_location);

        assert_eq!(id, None);
        assert_eq!(name, None);
        assert!(!inferred);
    }

    #[test]
    fn only_the_current_stage_gets_a_start_time_when_nothing_is_recorded() {
        let base = Utc::now();

        let stages = with_start_times(
            assemble_stages(&catalog(), &[], Some(workshop()), Some(branch())),
            base,
        );

        assert_eq!(stages[0].started_at, Some(base)); // Cutting: the current stage
        assert_eq!(stages[1].started_at, None);
        assert_eq!(stages[2].started_at, None);
        assert_eq!(stages[3].started_at, None);
    }

    #[test]
    fn each_recorded_stage_starts_when_the_previous_one_finished() {
        let base = Utc::now();
        let cutting_done = base + chrono::Duration::hours(2);
        let sewing_done = cutting_done + chrono::Duration::hours(3);

        let mut cutting = progress(1, "done");
        cutting.completed_at = cutting_done;
        let mut sewing = progress(2, "done");
        sewing.completed_at = sewing_done;

        let stages = with_start_times(
            assemble_stages(
                &catalog(),
                &[cutting, sewing],
                Some(workshop()),
                Some(branch()),
            ),
            base,
        );

        assert_eq!(stages[0].started_at, Some(base));
        assert_eq!(stages[0].completed_at, Some(cutting_done));
        assert_eq!(stages[1].started_at, Some(cutting_done));
        assert_eq!(stages[1].completed_at, Some(sewing_done));
        // Finishing is the current stage: it started when Sewing finished, and
        // nothing further down the list has a start time yet.
        assert_eq!(stages[2].started_at, Some(sewing_done));
        assert_eq!(stages[3].started_at, None);
    }

    #[test]
    fn a_stage_that_does_not_apply_never_gets_a_start_time_and_is_invisible_to_the_chain() {
        let base = Utc::now();
        let progress_rows = [
            progress(1, "done"),
            progress(2, "done"),
            progress(3, "done"),
        ];

        // Produced and collected at the same branch, so Location delivery
        // never applies — it sits last in sort order but must not swallow a
        // start time meant for nothing, nor stop Finishing's from chaining.
        let stages = with_start_times(
            assemble_stages(
                &catalog(),
                &progress_rows,
                Some(workshop()),
                Some(workshop()),
            ),
            base,
        );

        assert!(stages[2].started_at.is_some());
        assert_eq!(stages[3].started_at, None);
    }

    #[test]
    fn an_assigned_stage_carries_its_assignee() {
        let stages = with_assignees(
            assemble_stages(&catalog(), &[], Some(workshop()), Some(branch())),
            &[assignment(1, "mock-user-1", "Ahmed Al-Sayed")],
        );

        assert_eq!(stages[0].assignee_id.as_deref(), Some("mock-user-1"));
        assert_eq!(stages[0].assignee_name.as_deref(), Some("Ahmed Al-Sayed"));
        assert_eq!(stages[1].assignee_id, None);
    }

    #[test]
    fn assignment_is_independent_of_progress() {
        // Sewing is assigned but nobody has touched it yet — it's still the
        // stage the checklist reports as current.
        let stages = with_assignees(
            assemble_stages(
                &catalog(),
                &[progress(1, "done")],
                Some(workshop()),
                Some(branch()),
            ),
            &[assignment(2, "mock-user-2", "Fatima Al-Zahrani")],
        );

        assert_eq!(current_stage_name(&stages).as_deref(), Some("Sewing"));
        assert_eq!(
            stages[1].assignee_name.as_deref(),
            Some("Fatima Al-Zahrani")
        );
    }

    #[test]
    fn an_unassigned_stage_carries_no_assignee() {
        let stages = with_assignees(
            assemble_stages(&catalog(), &[], Some(workshop()), Some(branch())),
            &[],
        );

        assert!(stages.iter().all(|entry| entry.assignee_id.is_none()));
    }
}
