use std::collections::HashMap;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::features::customers;
use crate::features::users;
use crate::{
    error::AppError,
    list::{self, ListParams},
    state::AppState,
};

use super::{
    repository,
    types::{
        AssignStageInput, AssignmentRow, CreateRepairInput, OrderDetail, OrderListItem,
        OrderRepair, OrderRow, OrderStageEntry, PaymentType, ProgressRow, RepairListItem,
        RepairRow, RepairStatus, SetStageInput, StageRow, StageStatus, UpdateOrderInput,
        UpdateRepairInput,
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

// An explicit assignment (via PATCH /orders/:id) always wins. Absent one, a
// material stocked at exactly one usable location is inferred, so staff don't
// have to assign the obvious answer by hand — but a material split across
// several locations is left alone rather than guessed at, since there's
// nothing here to disambiguate it with.
fn effective_production(
    assigned_id: Option<Uuid>,
    assigned_name: Option<&str>,
    material_id: Option<Uuid>,
    single_location_materials: &HashMap<Uuid, (Uuid, String)>,
) -> (Option<Uuid>, Option<String>, bool) {
    if let Some(id) = assigned_id {
        return (Some(id), assigned_name.map(str::to_string), false);
    }

    match material_id.and_then(|id| single_location_materials.get(&id)) {
        Some((id, name)) => (Some(*id), Some(name.clone()), true),
        None => (None, None, false),
    }
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
// so the timestamp can never describe a repair that is open again. Receiving
// is separate (see `repair_received_time`): a completed repair keeps its
// `completed_at` once received, since that is when the work finished as
// opposed to when the customer collected it.
fn repair_completion_time(status: RepairStatus, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match status {
        RepairStatus::Completed => Some(now),
        _ => None,
    }
}

fn repair_received_time(status: RepairStatus, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match status {
        RepairStatus::Received => Some(now),
        _ => None,
    }
}

fn validate_receive_amount(amount: f64, payment_type: Option<PaymentType>) -> Result<(), AppError> {
    if amount < 0.0 {
        return Err(AppError::BadRequest(
            "a repair handover payment cannot be negative".to_string(),
        ));
    }
    if amount > 0.0 && payment_type.is_none() {
        return Err(AppError::BadRequest(
            "a repair handover payment needs a paymentType".to_string(),
        ));
    }
    Ok(())
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

// A checklist is worked strictly in order: a stage can only be recorded once
// every earlier applicable stage is done or skipped, and a recorded stage can
// only be reopened once every later applicable stage is pending again —
// otherwise an undo would open a gap in the middle of the checklist.
// Re-recording an earlier stage (done to skipped, new notes) needs no
// successor check: it leaves no gap behind. Stages that don't apply are
// transparent to the chain in both directions, the same way they are for
// start times, as are retired stages nobody recorded (invisible, so they
// can't be required).
//
// `catalog` is expected in checklist order (`list_stage_catalog` already
// returns `ORDER BY sort_order, name`) and `progress` filtered to this order.
fn validate_stage_sequence(
    catalog: &[StageRow],
    progress: &[ProgressRow],
    production_location_id: Option<Uuid>,
    receiving_location_id: Option<Uuid>,
    stage_id: Uuid,
    status: StageStatus,
) -> Result<(), AppError> {
    let target = catalog
        .iter()
        .find(|stage| stage.id == stage_id)
        .ok_or_else(|| AppError::NotFound(format!("order stage {stage_id} not found")))?;

    let is_recorded = |id: Uuid| progress.iter().any(|row| row.stage_id == id);
    let applies = |stage: &StageRow| {
        stage_applies(
            stage.requires_delivery,
            production_location_id,
            receiving_location_id,
        )
    };

    // The visible chain: active stages, plus anything already recorded (a
    // retired stage stays once acted on), plus the target itself so a retired
    // stage can still be judged against its neighbours.
    let chain: Vec<&StageRow> = catalog
        .iter()
        .filter(|stage| stage.is_active || stage.id == stage_id || is_recorded(stage.id))
        .collect();
    let pos = chain
        .iter()
        .position(|stage| stage.id == stage_id)
        .expect("the target is always part of the chain");

    // Recording never opens a gap — the target itself becomes acted on — so
    // a forward write only waits on its predecessors. Reopening does open
    // one, so an undo only waits on its successors. A pending write over a
    // recorded successor (a gap left by older data) is therefore allowed on
    // purpose: it fills the gap back in.
    if status == StageStatus::Pending {
        if let Some(blocker) = chain[pos + 1..]
            .iter()
            .find(|stage| applies(stage) && is_recorded(stage.id))
        {
            return Err(AppError::BadRequest(format!(
                "undo '{}' before reopening '{}'",
                blocker.name, target.name
            )));
        }
    } else if let Some(blocker) = chain[..pos]
        .iter()
        .find(|stage| applies(stage) && !is_recorded(stage.id))
    {
        return Err(AppError::BadRequest(format!(
            "complete '{}' before '{}'",
            blocker.name, target.name
        )));
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
            // The invoice's own creation moment, time included — the closest
            // thing to a build start the schema has, since `orders` carries
            // no `created_at`.
            row.invoice_date,
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
            received_at: repair.received_at,
            received_amount: repair.received_amount,
            received_payment_type: repair.received_payment_type.clone(),
            fixed_measurement_id: repair.fixed_measurement_id,
            notes: repair.notes.clone(),
        })
        .collect();

    OrderListItem {
        id: row.id,
        order_number: row.order_number,
        invoice_id: row.invoice_id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        measurement_id: row.measurement_id,
        customer_name: row.customer_name,
        customer_mobile: row.customer_mobile,
        material: row.material,
        material_source: row.material_source,
        material_sku: row.material_sku,
        material_amount: row.material_amount,
        price: row.price,
        is_urgent: row.is_urgent,
        urgent_charge: row.urgent_charge,
        status: row.status,
        outcome: row.outcome,
        closure_reason: row.closure_reason,
        closed_at: row.closed_at,
        closed_by: row.closed_by,
        credit_amount: row.credit_amount,
        retained_charge: row.retained_charge,
        restored_material_quantity: row.restored_material_quantity,
        collected_at: row.collected_at,
        ready_at: row.ready_at,
        ready_by: row.ready_by,
        thobe_type: row.thobe_type,
        f_pocket: row.f_pocket,
        s_pocket: row.s_pocket,
        collar: row.collar,
        sleeve: row.sleeve,
        patti: row.patti,
        emd: row.emd,
        more_details: row.more_details,
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
        invoice_balance_due: row.invoice_balance_due,
        invoice_gift_card_redeemed: row.invoice_gift_card_redeemed,
        invoice_payment_method: row.invoice_payment_method,
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
    let material_ids: Vec<Uuid> = rows.iter().filter_map(|row| row.material_id).collect();
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

// Paginated at the row level, then enriched: the checklist/repair queries run
// once per page rather than once per table, and the page's `total`/
// `pageCount` come straight from the filtered-row count `list::fetch_page`
// already computed, unaffected by anything the enrichment pass adds.
pub async fn list_orders(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<OrderListItem>, AppError> {
    let page = repository::list_orders(state, params).await?;
    let data = assemble(state, page.data).await?;

    Ok(list::Page {
        data,
        page: page.page,
        per_page: page.per_page,
        total: page.total,
        page_count: page.page_count,
    })
}

/// One order with everything a standalone detail page needs — the list row's
/// full assembly plus the human-readable invoice number and the measurement
/// snapshot the garment was cut to.
pub(crate) async fn get_order(state: &AppState, order_id: Uuid) -> Result<OrderDetail, AppError> {
    let row = repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    let order = assemble(state, vec![row.clone()])
        .await?
        .pop()
        .expect("one row in, one row out");

    let measurement = customers::repository::get_measurement(state, row.measurement_id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("measurement {} not found", row.measurement_id))
        })?;

    Ok(OrderDetail {
        order,
        invoice_number: row.invoice_number,
        measurement,
    })
}

/// Marks an order collected and records the payment taken at that pickup.
/// The invoice's money state is derived from the ledger, so nothing is
/// settled here explicitly: it simply becomes paid once every order on it is
/// collected *and* the payments cover the balance.
///
/// Deliberately not gated on the production checklist: staff hand a garment
/// over when it is ready, so the current stage is shown alongside rather than
/// blocking the counter.
pub async fn collect_order(
    state: &AppState,
    order_id: Uuid,
    amount: f64,
    payment_type: Option<PaymentType>,
) -> Result<OrderListItem, AppError> {
    if amount < 0.0 {
        return Err(AppError::BadRequest(
            "a pickup payment cannot be negative".to_string(),
        ));
    }
    if amount > 0.0 && payment_type.is_none() {
        return Err(AppError::BadRequest(
            "a pickup payment needs a paymentType".to_string(),
        ));
    }

    let order = repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let invoice_id = order.invoice_id;
    let mut tx = state.db().begin().await?;

    // Match invoice edits and whole-invoice receipts: always lock the invoice
    // before its orders, including pickups that take no payment.
    crate::features::invoices::repository::lock_invoice(&mut tx, invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {invoice_id} not found")))?;
    let locked = repository::lock_order(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    crate::features::returns::service::ensure_order_active(&mut tx, order_id).await?;
    if locked.status == "collected" {
        return Err(AppError::BadRequest(
            "this order is already collected".to_string(),
        ));
    }

    let invoice_id = locked.invoice_id;
    repository::mark_collected(&mut tx, order_id).await?;

    if amount > 0.0 {
        let payment_type = payment_type.expect("validated: payment type is set");
        let balance = crate::features::returns::repository::settlement(&mut tx, invoice_id).await?;
        crate::features::invoices::service::validate_payment_amount(
            amount,
            balance.net_total,
            balance.net_gift_card_redeemed,
            balance.net_amount_paid,
        )?;
        crate::features::invoices::repository::insert_payment(
            &mut tx,
            invoice_id,
            Some(order_id),
            amount,
            Some(payment_type.as_str()),
        )
        .await?;
    }

    let invoice_settled = repository::invoice_fully_collected(&mut tx, invoice_id).await?;

    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        invoice_id = %invoice_id,
        amount,
        invoice_settled,
        "order collected"
    );

    load_order(state, order_id).await
}

async fn active_order_transaction(
    state: &AppState,
    order_id: Uuid,
) -> Result<sqlx::PgTransaction<'static>, AppError> {
    let order = repository::get_order(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    let mut tx = state.db().begin().await?;
    crate::features::invoices::repository::lock_invoice(&mut tx, order.invoice_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("invoice {} not found", order.invoice_id)))?;
    repository::lock_order(&mut tx, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    crate::features::returns::service::ensure_order_active(&mut tx, order_id).await?;
    Ok(tx)
}

pub async fn update_order(
    state: &AppState,
    order_id: Uuid,
    input: UpdateOrderInput,
) -> Result<OrderListItem, AppError> {
    let mut tx = active_order_transaction(state, order_id).await?;
    repository::update_order(&mut tx, order_id, input.production_location_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    tracing::info!(
        order_id = %order_id,
        production_location_id = ?input.production_location_id,
        "order production location updated"
    );

    tx.commit().await?;

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
        single_location_map(state, &order.material_id.into_iter().collect::<Vec<_>>()).await?;
    let (effective_production_id, _, _) = effective_production(
        order.production_location_id,
        order.production_location.as_deref(),
        order.material_id,
        &single_location_materials,
    );

    let mut tx = active_order_transaction(state, order_id).await?;
    let (current_production, current_receiving) =
        super::readiness_repository::locations(&mut tx, order_id).await?;
    let effective_production_id = current_production.or(effective_production_id);
    validate_delivery_location(
        stage.requires_delivery,
        stage_applies(
            stage.requires_delivery,
            effective_production_id,
            current_receiving,
        ),
        input.status,
        input.location_id,
    )?;

    let progress = super::readiness_repository::progress(&mut tx, order_id).await?;
    validate_stage_sequence(
        &catalog,
        &progress,
        effective_production_id,
        current_receiving,
        stage_id,
        input.status,
    )?;

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
/// resolved here against the configured user directory rather than
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

    let assignee = match input.assignee_id {
        Some(assignee_id) => Some(
            users::service::list_users(state)
                .await?
                .into_iter()
                .find(|user| user.id == assignee_id)
                .ok_or_else(|| AppError::BadRequest(format!("unknown user {assignee_id}")))?,
        ),
        None => None,
    };
    let mut tx = active_order_transaction(state, order_id).await?;
    match assignee {
        Some(user) => {
            repository::set_assignee(&mut tx, order_id, stage_id, &user.id, &user.name).await?;

            tracing::info!(
                order_id = %order_id,
                stage_id = %stage_id,
                assignee_id = %user.id,
                assignee_name = %user.name,
                "order stage assignee set"
            );
        }
        None => {
            repository::clear_assignee(&mut tx, order_id, stage_id).await?;

            tracing::info!(
                order_id = %order_id,
                stage_id = %stage_id,
                "order stage assignee cleared"
            );
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
    let context = repository::repair_order_context(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;
    if let Some(measurement) = &input.measurement {
        crate::features::customers::types::validate_measurement(measurement)?;
    }

    let reason = normalized_reason(&input.reason)?;
    validate_charge(input.charge)?;

    let mut tx = active_order_transaction(state, order_id).await?;
    let repair_id = repository::create_repair(
        &mut tx,
        order_id,
        &reason,
        input.charge,
        input.notes.as_deref(),
    )
    .await?;
    if let Some(measurement) = &input.measurement {
        save_repair_measurement(&mut tx, context.customer_id, repair_id, measurement).await?;
    }
    tx.commit().await?;

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

    if input.status == Some(RepairStatus::Received) {
        return Err(AppError::BadRequest(
            "mark a ready repair as collected through its dedicated endpoint".to_string(),
        ));
    }

    let completed_at = input
        .status
        .and_then(|status| repair_completion_time(status, Utc::now()));

    let mut tx = active_order_transaction(state, order_id).await?;
    let locked = repository::lock_repair(&mut tx, repair_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("repair {repair_id} not found")))?;
    if input.status.is_some() && locked.status == RepairStatus::Received.as_str() {
        return Err(AppError::BadRequest(
            "a collected repair cannot change status".to_string(),
        ));
    }

    repository::update_repair(
        &mut tx,
        repair_id,
        reason.as_deref(),
        input.charge,
        input.status.map(RepairStatus::as_str),
        input.notes.as_deref(),
        completed_at,
    )
    .await?
    .ok_or_else(|| AppError::NotFound(format!("repair {repair_id} not found")))?;

    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        repair_id = %repair_id,
        status = ?input.status,
        "order repair updated"
    );

    load_order(state, order_id).await
}

/// Hands a completed repair back to the customer. Only `completed` repairs can
/// be received; anything else is a 400, and an already-`received` repair is
/// refused so a retry cannot record the handover payment twice. The money is
/// stored on the repair row itself — the invoice ledger is untouched, matching
/// how `charge` was always bookkeeping-only.
pub async fn receive_repair(
    state: &AppState,
    order_id: Uuid,
    repair_id: Uuid,
    amount: f64,
    payment_type: Option<PaymentType>,
) -> Result<OrderListItem, AppError> {
    validate_receive_amount(amount, payment_type)?;

    if !repository::repair_belongs_to_order(state, repair_id, order_id).await? {
        return Err(AppError::NotFound(format!(
            "repair {repair_id} not found on order {order_id}"
        )));
    }

    let mut tx = active_order_transaction(state, order_id).await?;
    let locked = repository::lock_repair(&mut tx, repair_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("repair {repair_id} not found")))?;

    if locked.status == RepairStatus::Received.as_str() {
        return Err(AppError::BadRequest(
            "this repair is already collected".to_string(),
        ));
    }
    if locked.status != RepairStatus::Completed.as_str() {
        return Err(AppError::BadRequest(
            "only a ready repair can be marked as collected".to_string(),
        ));
    }

    let received_at = repair_received_time(RepairStatus::Received, Utc::now())
        .expect("received status always stamps a time");
    repository::mark_repair_received(
        &mut tx,
        repair_id,
        received_at,
        amount,
        payment_type.map(|payment| payment.as_str()),
    )
    .await?;
    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        repair_id = %repair_id,
        amount,
        "order repair received"
    );

    load_order(state, order_id).await
}

/// Records the measurement fix a repair needed, for future orders. Mirrors the
/// invoice create rule: reuse the customer's latest row when the values match,
/// else insert a fresh one — never rewrites the order's own snapshot. The new
/// row's id is stored on the repair, so the receipt and later orders can read
/// what changed.
pub async fn set_repair_measurement(
    state: &AppState,
    order_id: Uuid,
    repair_id: Uuid,
    measurement: crate::features::customers::types::CreateMeasurementInput,
) -> Result<OrderListItem, AppError> {
    if !repository::repair_belongs_to_order(state, repair_id, order_id).await? {
        return Err(AppError::NotFound(format!(
            "repair {repair_id} not found on order {order_id}"
        )));
    }

    let context = repository::repair_order_context(state, order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("order {order_id} not found")))?;

    let mut tx = active_order_transaction(state, order_id).await?;
    let measurement_id =
        save_repair_measurement(&mut tx, context.customer_id, repair_id, &measurement).await?;
    tx.commit().await?;

    tracing::info!(
        order_id = %order_id,
        repair_id = %repair_id,
        measurement_id = %measurement_id,
        "order repair measurement fix recorded"
    );

    load_order(state, order_id).await
}

async fn save_repair_measurement(
    tx: &mut sqlx::PgTransaction<'_>,
    customer_id: Uuid,
    repair_id: Uuid,
    measurement: &crate::features::customers::types::CreateMeasurementInput,
) -> Result<Uuid, AppError> {
    crate::features::customers::types::validate_measurement(measurement)?;
    let measurement_id =
        match crate::features::customers::repository::latest_measurement(tx, customer_id).await? {
            Some((id, ref values))
                if crate::features::customers::types::measurement_values_equal(
                    values,
                    measurement,
                ) =>
            {
                id
            }
            _ => {
                crate::features::customers::repository::insert_measurement(
                    tx,
                    customer_id,
                    measurement,
                )
                .await?
            }
        };
    repository::set_repair_fixed_measurement(tx, repair_id, measurement_id).await?;
    Ok(measurement_id)
}

pub async fn list_all_repairs(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<RepairListItem>, AppError> {
    repository::list_all_repairs(state, params).await
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
            RepairStatus::Received,
        ] {
            assert_eq!(repair_completion_time(status, now), None, "{status:?}");
        }
    }

    #[test]
    fn a_received_repair_is_stamped_and_any_other_status_clears_it() {
        let now = Utc::now();

        assert_eq!(repair_received_time(RepairStatus::Received, now), Some(now));
        for status in [
            RepairStatus::Open,
            RepairStatus::InProgress,
            RepairStatus::Completed,
            RepairStatus::Cancelled,
        ] {
            assert_eq!(repair_received_time(status, now), None, "{status:?}");
        }
    }

    #[test]
    fn a_repair_handover_accepts_zero_or_a_paid_amount_with_a_method() {
        use crate::features::invoices::types::PaymentType;

        assert!(validate_receive_amount(0.0, None).is_ok());
        assert!(validate_receive_amount(12.5, Some(PaymentType::Cash)).is_ok());

        let missing_method = validate_receive_amount(12.5, None).unwrap_err();
        assert!(matches!(missing_method, AppError::BadRequest(_)));

        let negative = validate_receive_amount(-1.0, None).unwrap_err();
        assert!(matches!(negative, AppError::BadRequest(_)));
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
            Some(cotton()),
            &single_location,
        );

        assert_eq!(id, Some(branch()));
        assert_eq!(name.as_deref(), Some("Riyadh Main Branch"));
        assert!(!inferred);
    }

    #[test]
    fn customer_material_never_infers_a_location_from_shop_stock() {
        let stock = [(cotton(), (workshop(), "Workshop".to_string()))].into();
        assert_eq!(
            effective_production(None, None, None, &stock),
            (None, None, false)
        );
        assert_eq!(
            effective_production(Some(branch()), Some("Branch"), None, &stock),
            (Some(branch()), Some("Branch".to_string()), false)
        );
    }

    #[test]
    fn a_material_stocked_at_exactly_one_location_is_inferred() {
        let mut single_location = HashMap::new();
        single_location.insert(cotton(), (workshop(), "Central Workshop".to_string()));

        let (id, name, inferred) =
            effective_production(None, None, Some(cotton()), &single_location);

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

        let (id, name, inferred) =
            effective_production(None, None, Some(cotton()), &single_location);

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

    fn sequence(
        catalog: &[StageRow],
        progress: &[ProgressRow],
        production_location_id: Option<Uuid>,
        receiving_location_id: Option<Uuid>,
        stage_sort_order: i32,
        status: StageStatus,
    ) -> Result<(), AppError> {
        validate_stage_sequence(
            catalog,
            progress,
            production_location_id,
            receiving_location_id,
            Uuid::from_u128(stage_sort_order as u128),
            status,
        )
    }

    #[test]
    fn recording_the_current_stage_is_allowed() {
        assert!(sequence(
            &catalog(),
            &[],
            Some(workshop()),
            Some(branch()),
            1,
            StageStatus::Done
        )
        .is_ok());
    }

    #[test]
    fn recording_ahead_of_a_pending_stage_is_rejected() {
        let error = sequence(
            &catalog(),
            &[],
            Some(workshop()),
            Some(branch()),
            2,
            StageStatus::Done,
        )
        .unwrap_err();

        match error {
            AppError::BadRequest(message) => {
                assert!(message.contains("Cutting"), "{message}");
                assert!(message.contains("Sewing"), "{message}");
            }
            other => panic!("expected a BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn a_skipped_predecessor_satisfies_the_sequence() {
        assert!(sequence(
            &catalog(),
            &[progress(1, "skipped")],
            Some(workshop()),
            Some(branch()),
            2,
            StageStatus::Done,
        )
        .is_ok());
    }

    #[test]
    fn reopening_an_earlier_stage_is_rejected_while_a_later_one_is_recorded() {
        let error = sequence(
            &catalog(),
            &[progress(1, "done"), progress(2, "done")],
            Some(workshop()),
            Some(branch()),
            1,
            StageStatus::Pending,
        )
        .unwrap_err();

        match error {
            AppError::BadRequest(message) => {
                assert!(message.contains("Sewing"), "{message}");
                assert!(message.contains("Cutting"), "{message}");
            }
            other => panic!("expected a BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn reopening_the_last_recorded_stage_is_allowed() {
        assert!(sequence(
            &catalog(),
            &[progress(1, "done"), progress(2, "done")],
            Some(workshop()),
            Some(branch()),
            2,
            StageStatus::Pending,
        )
        .is_ok());
    }

    #[test]
    fn re_recording_an_earlier_stage_leaves_no_gap_so_it_is_allowed() {
        // Overwriting Cutting's entry while Sewing is still recorded changes
        // history but leaves every stage acted on, so unlike an undo it needs
        // no successor check.
        assert!(sequence(
            &catalog(),
            &[progress(1, "done"), progress(2, "done")],
            Some(workshop()),
            Some(branch()),
            1,
            StageStatus::Skipped,
        )
        .is_ok());
    }

    #[test]
    fn re_recording_the_last_recorded_stage_is_allowed() {
        assert!(sequence(
            &catalog(),
            &[progress(1, "done")],
            Some(workshop()),
            Some(branch()),
            1,
            StageStatus::Skipped,
        )
        .is_ok());
    }

    #[test]
    fn a_stage_that_does_not_apply_is_transparent_to_the_sequence() {
        // A delivery stage in the middle of the catalog, produced and
        // collected at the same branch so it never applies — Sewing must not
        // wait on it.
        let mut catalog = catalog();
        catalog.insert(
            1,
            StageRow {
                id: Uuid::from_u128(50),
                name: "Transfer".to_string(),
                sort_order: 1,
                requires_delivery: true,
                is_active: true,
            },
        );

        assert!(sequence(
            &catalog,
            &[progress(1, "done")],
            Some(workshop()),
            Some(workshop()),
            2,
            StageStatus::Done,
        )
        .is_ok());
    }

    #[test]
    fn a_retired_stage_nobody_touched_is_transparent_to_the_sequence() {
        let mut catalog = catalog();
        catalog[1].is_active = false;

        assert!(sequence(
            &catalog,
            &[progress(1, "done")],
            Some(workshop()),
            Some(branch()),
            3,
            StageStatus::Done,
        )
        .is_ok());
    }

    #[test]
    fn reopening_a_stage_nobody_recorded_is_a_noop() {
        // Clearing an absent row deletes nothing; still allowed so undoing
        // stays idempotent.
        assert!(sequence(
            &catalog(),
            &[progress(1, "done")],
            Some(workshop()),
            Some(branch()),
            2,
            StageStatus::Pending,
        )
        .is_ok());
    }

    #[test]
    fn sequencing_an_unknown_stage_is_not_found() {
        let error = sequence(
            &catalog(),
            &[],
            Some(workshop()),
            Some(branch()),
            99,
            StageStatus::Done,
        )
        .unwrap_err();

        assert!(matches!(error, AppError::NotFound(_)));
    }
}

#[cfg(test)]
mod repair_collection_tests {
    use super::*;
    use crate::test_support;
    use sqlx::PgPool;

    #[sqlx::test]
    async fn order_mutations_and_adjustments_work_with_a_single_pool_connection(db: PgPool) {
        use crate::features::{invoices, returns};
        use serde_json::{from_value, json};

        let (invoice_id, orders, production, _) = test_support::invoice(&db, 2, false).await;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(2))
            .connect_with((*db.connect_options()).clone())
            .await
            .unwrap();
        let state = test_support::state(pool.clone(), None, None).await;
        let order_id = orders[0];
        let stage_id = repository::list_stage_catalog(&state).await.unwrap()[0].id;

        update_order(
            &state,
            order_id,
            from_value(json!({"productionLocationId": production})).unwrap(),
        )
        .await
        .unwrap();
        set_stage(
            &state,
            order_id,
            stage_id,
            from_value(json!({"status": "done"})).unwrap(),
        )
        .await
        .unwrap();
        set_assignee(&state, order_id, stage_id, AssignStageInput::default())
            .await
            .unwrap();
        let updated = create_repair(&state, order_id, from_value(json!({
                "reason": "Fit adjustment", "measurement": {"date": "2026-10-24", "type": "body", "fit": "medium", "chest": 50}
        })).unwrap()).await.unwrap();
        let repair_id = updated.repairs[0].id;
        update_repair(
            &state,
            order_id,
            repair_id,
            from_value(json!({"status": "completed"})).unwrap(),
        )
        .await
        .unwrap();
        set_repair_measurement(
            &state,
            order_id,
            repair_id,
            from_value(json!({
                "date": "2026-10-24", "type": "body", "fit": "medium", "chest": 52
            }))
            .unwrap(),
        )
        .await
        .unwrap();
        receive_repair(&state, order_id, repair_id, 0.0, None)
            .await
            .unwrap();

        invoices::service::record_payment(
            &state,
            invoice_id,
            invoices::types::RecordPaymentInput {
                request_id: Uuid::new_v4(),
                amount: 20.0,
                payment_type: PaymentType::Cash,
                order_id: None,
            },
        )
        .await
        .unwrap();
        collect_order(&state, order_id, 0.0, None).await.unwrap();
        returns::service::create_return(
            &state,
            invoice_id,
            from_value(json!({
                "requestId": Uuid::new_v4(), "reason": "Return collected garment",
                "lines": [{"lineId": order_id, "quantity": 1, "restock": false}]
            }))
            .unwrap(),
            "staff",
        )
        .await
        .unwrap();
        returns::service::cancellation_context(&state, orders[1])
            .await
            .unwrap();
        returns::service::cancel_order(
            &state,
            orders[1],
            from_value(json!({
                "requestId": Uuid::new_v4(), "reason": "Cancel remaining garment",
                "refund": {"timing": "later"}
            }))
            .unwrap(),
            "staff",
        )
        .await
        .unwrap();
        returns::service::create_refund(
            &state,
            invoice_id,
            from_value(json!({
                "requestId": Uuid::new_v4(), "reason": "Settle deferred refund", "amount": 20,
                "paymentType": "cash"
            }))
            .unwrap(),
            "staff",
        )
        .await
        .unwrap();
        let context = returns::service::context(&state, invoice_id).await.unwrap();
        assert_eq!(context.settlement.amount_credited, 200.0);
        assert_eq!(context.settlement.cash_refunded, 20.0);
        assert_eq!(context.settlement.balance_due, 0.0);
        assert_eq!(context.settlement.refund_due, 0.0);
        pool.close().await;
    }

    #[sqlx::test]
    async fn cancelled_orders_block_repair_collection_and_measurement_fixes(db: PgPool) {
        let (_, orders, _, _) = test_support::invoice(&db, 1, false).await;
        let order_id = orders[0];
        let repair_id: Uuid = sqlx::query_scalar("INSERT INTO order_repairs(order_id,reason,status) VALUES($1,'Fit adjustment','completed') RETURNING id")
            .bind(order_id).fetch_one(&db).await.unwrap();
        let state = test_support::state(db.clone(), None, None).await;
        crate::features::returns::service::cancel_order(&state,order_id,serde_json::from_value(serde_json::json!({
            "requestId":Uuid::new_v4(),"reason":"Customer cancellation","workChargeConfirmed":true
        })).unwrap(),"staff").await.unwrap();
        assert!(matches!(
            receive_repair(&state, order_id, repair_id, 0.0, None).await,
            Err(AppError::BadRequest(_))
        ));
        let measurement = serde_json::from_value(
            serde_json::json!({"date":"2026-10-23","type":"body","fit":"medium","chest":52}),
        )
        .unwrap();
        assert!(matches!(
            set_repair_measurement(&state, order_id, repair_id, measurement).await,
            Err(AppError::BadRequest(_))
        ));
        let saved: (String, Option<Uuid>, Option<DateTime<Utc>>) = sqlx::query_as(
            "SELECT status,fixed_measurement_id,received_at FROM order_repairs WHERE id=$1",
        )
        .bind(repair_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(saved, ("completed".into(), None, None));
    }

    #[sqlx::test]
    async fn collected_repairs_keep_their_status_and_original_payment(db: PgPool) {
        let (_, orders, _, _) = test_support::invoice(&db, 1, false).await;
        let order_id = orders[0];
        let repair_id: Uuid = sqlx::query_scalar("INSERT INTO order_repairs(order_id, reason, status, completed_at, received_at, received_amount, received_payment_type) VALUES ($1, 'Fit adjustment', 'received', now(), now(), 3.5, 'cash') RETURNING id")
            .bind(order_id).fetch_one(&db).await.unwrap();
        let original: (DateTime<Utc>, DateTime<Utc>, f64, String) = sqlx::query_as("SELECT completed_at, received_at, received_amount::float8, received_payment_type FROM order_repairs WHERE id=$1")
            .bind(repair_id).fetch_one(&db).await.unwrap();
        let state = test_support::state(db.clone(), None, None).await;
        for status in [
            RepairStatus::Open,
            RepairStatus::InProgress,
            RepairStatus::Completed,
            RepairStatus::Cancelled,
        ] {
            let input = UpdateRepairInput {
                status: Some(status),
                ..Default::default()
            };
            assert!(matches!(
                update_repair(&state, order_id, repair_id, input).await,
                Err(AppError::BadRequest(_))
            ));
        }
        let metadata = UpdateRepairInput {
            notes: Some("Customer collected the garment".into()),
            ..Default::default()
        };
        update_repair(&state, order_id, repair_id, metadata)
            .await
            .unwrap();
        assert!(matches!(
            receive_repair(&state, order_id, repair_id, 5.0, Some(PaymentType::Card)).await,
            Err(AppError::BadRequest(_))
        ));
        let saved: (String, DateTime<Utc>, DateTime<Utc>, f64, String, String) = sqlx::query_as("SELECT status, completed_at, received_at, received_amount::float8, received_payment_type, notes FROM order_repairs WHERE id=$1")
            .bind(repair_id).fetch_one(&db).await.unwrap();
        assert_eq!(saved.0, "received");
        assert_eq!((saved.1, saved.2, saved.3, saved.4), original);
        assert_eq!(saved.5, "Customer collected the garment");
    }
}
