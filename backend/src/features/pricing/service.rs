use crate::error::AppError;

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
