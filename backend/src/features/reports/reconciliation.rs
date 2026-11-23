use crate::error::AppError;

use super::types::{ClosingCounts, Comparison, ComparisonLine, SalesClosing};

pub(super) fn fils(value: f64, signed: bool) -> Result<i64, AppError> {
    if !value.is_finite()
        || value.abs() > 99_999_999.999
        || (!signed && value < 0.0)
        || (value * 1000.0 - (value * 1000.0).round()).abs() > 0.0001
    {
        return Err(AppError::BadRequest(
            "Enter valid BHD amounts with at most three decimal places.".into(),
        ));
    }
    Ok((value * 1000.0).round() as i64)
}

pub fn compare(report: &SalesClosing, counts: &ClosingCounts) -> Result<Comparison, AppError> {
    if !counts.branch_activity_confirmed {
        return Err(AppError::BadRequest(
            "Confirm the listed payments and refunds were handled at this branch.".into(),
        ));
    }
    let saved_opening = report.opening.as_ref().ok_or_else(|| {
        AppError::BadRequest(
            "Save opening cash separately before checking the closing cash.".into(),
        )
    })?;
    let opening = fils(saved_opening.amount, false)?;
    if fils(counts.opening_cash, false)? != opening {
        return Err(AppError::Conflict(
            "Opening cash must match the saved opening. Refresh the report.".into(),
        ));
    }
    let added = fils(counts.cash_added, false)?;
    let removed = fils(counts.cash_removed, false)?;
    let actual = [
        fils(counts.actual_cash, false)?,
        fils(counts.actual_benefit, true)?,
        fils(counts.actual_card, true)?,
    ];
    if counts.notes.trim().chars().count() > 2000 {
        return Err(AppError::BadRequest(
            "Keep closing notes within 2,000 characters.".into(),
        ));
    }
    let mut lines = Vec::new();
    let mut has_variance = false;
    for (index, method) in ["cash", "benefit", "card"].into_iter().enumerate() {
        let tender = report.tenders.iter().find(|t| t.method == method);
        let recorded = tender.map_or(0.0, |t| t.net);
        let recorded = fils(recorded, true)?;
        // Card/Benefit expenses are outgoing business payments, not negative
        // merchant receipts on the terminal being reconciled.
        let expenses = if method == "cash" {
            fils(tender.map_or(0.0, |t| t.expenses), false)?
        } else {
            0
        };
        let expected = recorded - expenses
            + if method == "cash" {
                opening + added - removed
            } else {
                0
            };
        let difference = actual[index] - expected;
        has_variance |= difference != 0;
        lines.push(ComparisonLine {
            method: method.into(),
            recorded: recorded as f64 / 1000.0,
            expected: expected as f64 / 1000.0,
            actual: actual[index] as f64 / 1000.0,
            difference: difference as f64 / 1000.0,
        });
    }
    if (has_variance || added != 0 || removed != 0) && counts.notes.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Explain differences and cash movements in the closing notes.".into(),
        ));
    }
    Ok(Comparison {
        matched: !has_variance
            && report.summary.unrecorded_method_count == 0
            && report.unassigned_activity_count == 0,
        unresolved_methods: report.summary.unrecorded_method_count,
        lines,
    })
}
