use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

use super::{reconciliation, repository, till_repository, till_service, types::*};

pub(super) fn day_bounds(
    date: NaiveDate,
    zone: Tz,
) -> Result<(DateTime<Utc>, DateTime<Utc>), AppError> {
    let next = date
        .succ_opt()
        .ok_or_else(|| AppError::BadRequest("Invalid report date.".into()))?;
    let midnight = |day: NaiveDate| {
        zone.from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .map(|time| time.with_timezone(&Utc))
            .ok_or_else(|| {
                AppError::BadRequest("This date has no midnight in the business timezone.".into())
            })
    };
    Ok((midnight(date)?, midnight(next)?))
}

pub async fn sales_closing(
    state: &AppState,
    date: Option<NaiveDate>,
    branch_id: Uuid,
) -> Result<SalesClosing, AppError> {
    let zone = state.timezone()?;
    let now = Utc::now();
    let date = date.unwrap_or_else(|| now.with_timezone(&zone).date_naive());
    let mut tx = state.db().begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let mut report = if let Some(closed) =
        super::day_repository::closure(&mut tx, branch_id, date).await?
    {
        closed.into_report()
    } else if let Some(missed) = super::rollout_repository::missed(&mut tx, branch_id, date).await?
    {
        missed.into_report()
    } else {
        let mut report = load(&mut tx, date, zone, now, branch_id).await?;
        report.last_check = repository::latest_check(&mut tx, branch_id, date).await?;
        report
    };
    report.business_date = Some(now.with_timezone(&zone).date_naive());
    report.policy = super::rollout_repository::policy(&mut tx, branch_id)
        .await?
        .map(|p| p.into_policy());
    report.read_only = report.closure.is_some()
        || report.missed_closing.is_some()
        || date != report.business_date.unwrap()
        || report.policy.as_ref().is_none_or(|p| date < p.starts_on);
    report.previous_unclosed_date = super::day_repository::previous_unclosed(
        &mut tx,
        branch_id,
        zone.name(),
        now.with_timezone(&zone).date_naive(),
    )
    .await?;
    tx.commit().await?;
    Ok(report)
}

pub(super) async fn load(
    db: &mut sqlx::PgConnection,
    date: NaiveDate,
    zone: Tz,
    now: DateTime<Utc>,
    branch_id: Uuid,
) -> Result<SalesClosing, AppError> {
    let name = repository::branch_name(db, branch_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Branch not found.".into()))?;
    let (start, end) = day_bounds(date, zone)?;
    let rows = repository::activity(db, start, end, branch_id).await?;
    let mut report = assemble(date, zone, now, branch_id, name, rows);
    report.opening = till_repository::opening(db, branch_id, date, None)
        .await?
        .map(till_repository::OpeningRow::into_opening);
    report.expenses = till_repository::expenses(db, Some(branch_id), Some(date), None, None)
        .await?
        .into_iter()
        .map(till_repository::ExpenseRow::into_expense)
        .collect();
    for tender in &mut report.tenders {
        let paid_fils: i64 = report
            .expenses
            .iter()
            .filter(|e| e.voided_at.is_none() && e.payment_type == tender.method)
            .map(|e| (e.amount * 1000.0).round() as i64)
            .sum();
        tender.expenses = paid_fils as f64 / 1000.0;
        tender.after_expenses = ((tender.net * 1000.0).round() as i64 - paid_fils) as f64 / 1000.0;
    }
    fingerprint(&mut report);
    Ok(report)
}

pub async fn save_check(
    state: &AppState,
    input: SaveClosingInput,
    actor: &str,
) -> Result<ClosingCheck, AppError> {
    let hash = crate::idempotency::request_hash("branch.closing.v1", input.branch_id, &input);
    let mut tx = state.db().begin().await?;
    // Shared with financial writes and the final close.
    till_service::lock_day(&mut tx, input.branch_id, input.date).await?;
    if let Some(saved) = repository::replay(&mut tx, input.request_id).await? {
        crate::idempotency::verify_request_hash(&saved.request_hash, &hash)?;
        return Ok(saved.into_check());
    }
    super::day_service::editable(state, &mut tx, input.branch_id, input.date).await?;
    let report = load(
        &mut tx,
        input.date,
        state.timezone()?,
        Utc::now(),
        input.branch_id,
    )
    .await?;
    if report.fingerprint != input.fingerprint {
        return Err(AppError::Conflict(
            "Recorded transactions changed. Refresh and check the totals again.".into(),
        ));
    }
    let comparison = reconciliation::compare(&report, &input.counts)?;
    let saved = repository::save_check(&mut tx, &input, &hash, &comparison, &report, actor).await?;
    tx.commit().await?;
    Ok(saved)
}

pub(super) fn assemble(
    date: NaiveDate,
    zone: Tz,
    generated_at: DateTime<Utc>,
    branch_id: Uuid,
    branch_name: String,
    rows: Vec<ActivityRow>,
) -> SalesClosing {
    let mut unassigned_activity_count = 0;
    let mut unrecorded_method_count = 0;
    let mut count = 0;
    let (mut sales, mut taxable, mut vat, mut gift_sales, mut credits) =
        (0i64, 0i64, 0i64, 0i64, 0i64);
    let (mut payments, mut repairs, mut refunds, mut redeemed, mut restored) =
        (0i64, 0i64, 0i64, 0i64, 0i64);
    let methods = ["cash", "benefit", "card", "unknown"];
    // [invoice receipts, repair receipts, payouts] per external method.
    let mut tenders = [[0i64; 3]; 4];
    let mut activity = Vec::with_capacity(rows.len());
    for row in rows {
        if row.branch_id != Some(branch_id) {
            if row.branch_id.is_none()
                && matches!(row.kind.as_str(), "payment" | "refund" | "repair_payment")
            {
                unassigned_activity_count += 1;
            }
            continue;
        }
        let method = row.method.as_deref().unwrap_or("unknown");
        let index = methods
            .iter()
            .position(|candidate| *candidate == method)
            .unwrap_or(3);
        if index == 3
            && matches!(row.kind.as_str(), "payment" | "refund" | "repair_payment")
            && method != "gift_card"
        {
            unrecorded_method_count += 1;
        }
        match row.kind.as_str() {
            "sale" => {
                count += 1;
                sales += row.amount_cents;
                taxable += row.taxable_cents;
                vat += row.vat_cents;
                gift_sales += row.gift_sales_cents;
            }
            "credit" => credits += row.amount_cents,
            "payment" => {
                payments += row.amount_cents;
                tenders[index][0] += row.amount_cents;
            }
            "repair_payment" => {
                repairs += row.amount_cents;
                tenders[index][1] += row.amount_cents;
            }
            "gift_card_redemption" => redeemed += row.amount_cents,
            "refund" if method == "gift_card" => restored += row.amount_cents,
            "refund" => {
                refunds += row.amount_cents;
                tenders[index][2] += row.amount_cents;
            }
            _ => unreachable!("repository returned an unknown report event"),
        }
        activity.push(Activity {
            id: row.id,
            invoice_id: row.invoice_id,
            invoice_number: row.invoice_number,
            occurred_at: row.occurred_at,
            kind: row.kind,
            method: row.method,
            amount: money(row.amount_cents),
        });
    }
    let mut report = SalesClosing {
        policy: None,
        missed_closing: None,
        read_only: false,
        closure: None,
        business_date: None,
        previous_unclosed_date: None,
        opening: None,
        expenses: Vec::new(),
        branch_id,
        branch_name,
        fingerprint: String::new(),
        last_check: None,
        unassigned_activity_count,
        date,
        timezone: zone.name().into(),
        generated_at,
        summary: ClosingSummary {
            unrecorded_method_count,
            invoice_count: count,
            invoice_total: money(sales),
            taxable_amount: money(taxable),
            vat_amount: money(vat),
            gift_card_sales: money(gift_sales),
            credits: money(credits),
            net_invoice_activity: money(sales - credits),
            invoice_payments: money(payments),
            repair_payments: money(repairs),
            external_refunds: money(refunds),
            net_external_receipts: money(payments + repairs - refunds),
            gift_card_redemptions: money(redeemed),
            gift_card_refunds: money(restored),
        },
        tenders: methods
            .into_iter()
            .zip(tenders)
            .map(|(method, amounts)| TenderSummary {
                method: method.into(),
                invoice_payments: money(amounts[0]),
                repair_payments: money(amounts[1]),
                refunds: money(amounts[2]),
                net: money(amounts[0] + amounts[1] - amounts[2]),
                expenses: 0.0,
                after_expenses: money(amounts[0] + amounts[1] - amounts[2]),
            })
            .collect(),
        activity,
    };
    fingerprint(&mut report);
    report
}

fn fingerprint(report: &mut SalesClosing) {
    let content = serde_json::json!([
        report.date,
        report.timezone,
        report.summary,
        report.tenders,
        report.activity,
        report.unassigned_activity_count,
        report.opening,
        report.expenses,
    ]);
    report.fingerprint = hex::encode(crate::idempotency::request_hash(
        "branch.closing.report.v2",
        report.branch_id,
        &content,
    ));
}

fn money(cents: i64) -> f64 {
    cents as f64 / 100.0
}
