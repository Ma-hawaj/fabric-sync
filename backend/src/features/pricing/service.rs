use super::types::{UrgentChargeRule, UrgentChargeUnit};
use crate::error::AppError;

pub fn urgent_charge(
    price: f64,
    is_urgent: bool,
    rule: Option<UrgentChargeRule>,
) -> Result<f64, AppError> {
    if !is_urgent {
        return Ok(0.0);
    }
    let rule =
        rule.ok_or_else(|| AppError::BadRequest("urgent pricing is not configured".into()))?;
    let raw = match rule.unit {
        UrgentChargeUnit::Amount => rule.amount,
        UrgentChargeUnit::Percent => price * rule.amount / 100.0,
    };
    let charge = (raw * 100.0).round() / 100.0;
    validate_amount(charge)?;
    if charge <= 0.0 {
        return Err(AppError::BadRequest(
            "the urgent charge must be greater than zero".into(),
        ));
    }
    Ok(charge)
}

// Shared metre ranges for all materials. Keep in sync with
// frontend/src/features/invoices/lib/garment-pricing.ts.
pub const JUNIOR_BELOW: f64 = 3.0;
pub const LARGE_ABOVE: f64 = 4.0;

pub fn tier_price(quantity: f64, junior: f64, normal: f64, large: f64) -> f64 {
    if quantity < JUNIOR_BELOW {
        junior
    } else if quantity > LARGE_ABOVE {
        large
    } else {
        normal
    }
}

pub fn validate_amount(value: f64) -> Result<(), AppError> {
    if !value.is_finite()
        || !(0.0..=99_999_999.99).contains(&value)
        || (value * 100.0 - (value * 100.0).round()).abs() > 1e-6
    {
        return Err(AppError::BadRequest(
            "enter a nonnegative amount with at most two decimal places".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urgent_charges_are_server_calculated_and_only_apply_to_flagged_orders() {
        let fixed = UrgentChargeRule {
            amount: 5.0,
            unit: UrgentChargeUnit::Amount,
        };
        let percent = UrgentChargeRule {
            amount: 10.0,
            unit: UrgentChargeUnit::Percent,
        };
        assert_eq!(urgent_charge(22.5, true, Some(fixed)).unwrap(), 5.0);
        assert_eq!(urgent_charge(27.5, true, Some(percent)).unwrap(), 2.75);
        assert_eq!(urgent_charge(22.55, true, Some(percent)).unwrap(), 2.26);
        assert_eq!(urgent_charge(100.0, false, None).unwrap(), 0.0);
        assert!(urgent_charge(100.0, true, None).is_err());
    }
    #[test]
    fn tier_boundaries_do_not_multiply_by_metres() {
        for (quantity, expected) in [(2.99, 10.0), (3.0, 20.0), (4.0, 20.0), (4.01, 30.0)] {
            assert_eq!(tier_price(quantity, 10.0, 20.0, 30.0), expected);
        }
    }
    #[test]
    fn rejects_invalid_amounts() {
        for value in [-1.0, f64::INFINITY, f64::NAN, 0.001, 100_000_000.0] {
            assert!(validate_amount(value).is_err());
        }
        for value in [0.0, 12.34, 99_999_999.99] {
            assert!(validate_amount(value).is_ok());
        }
    }
}
