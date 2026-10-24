use std::collections::BTreeMap;

use super::types::{Customer, Destination};

pub fn normalize(raw: &str, region: &str) -> Option<String> {
    let country = region.parse::<phonenumber::country::Id>().ok()?;
    let raw = raw.trim();
    // International access prefixes are distinct from a local subscriber number.
    let international = raw.strip_prefix("00").map(|v| format!("+{v}"));
    let number = phonenumber::parse(Some(country), international.as_deref().unwrap_or(raw)).ok()?;
    if !number.is_valid() {
        return None;
    }
    Some(number.format().mode(phonenumber::Mode::E164).to_string())
}

pub fn destinations(
    customers: Vec<Customer>,
    region: &str,
) -> (Vec<Destination>, Vec<Destination>) {
    let mut grouped = BTreeMap::<String, Destination>::new();
    let mut excluded = Vec::new();
    for customer in customers {
        let Some(mobile) = normalize(&customer.mobile_no, region) else {
            excluded.push(Destination {
                mobile: customer.mobile_no.clone(),
                customers: vec![customer],
                excluded_reason: Some("Missing or invalid mobile number".into()),
            });
            continue;
        };
        let destination = grouped
            .entry(mobile.clone())
            .or_insert_with(|| Destination {
                mobile,
                customers: vec![],
                excluded_reason: None,
            });
        // A shared destination with an opted-out customer is not silently reached
        // through another customer record using the same phone.
        if !customer.enabled {
            destination.excluded_reason =
                Some("WhatsApp invoice updates are disabled for this mobile".into());
        }
        if !destination.customers.iter().any(|c| c.id == customer.id) {
            destination.customers.push(customer);
        }
    }
    let mut eligible = Vec::new();
    for destination in grouped.into_values() {
        if destination.excluded_reason.is_some() {
            excluded.push(destination);
        } else {
            eligible.push(destination);
        }
    }
    (eligible, excluded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    fn customer(id: u128, mobile: &str) -> Customer {
        Customer {
            id: Uuid::from_u128(id),
            name: format!("Customer {id}"),
            mobile_no: mobile.into(),
            enabled: true,
        }
    }
    #[test]
    fn groups_shared_mobiles_across_customers_and_international_formats() {
        let (recipients, excluded) = destinations(
            vec![
                customer(1, "33112233"),
                customer(1, "33112233"),
                customer(2, "+973 3311 2233"),
                customer(3, "00973-3311-2233"),
                customer(4, "+973 3399 1122"),
            ],
            "BH",
        );
        assert_eq!(recipients.len(), 2);
        assert!(excluded.is_empty());
        assert_eq!(recipients[0].mobile, "+97333112233");
        assert_eq!(recipients[0].customers.len(), 3);
    }
    #[test]
    fn rejects_invalid_numbers_and_honors_a_shared_phone_opt_out() {
        let mut opted_out = customer(2, "+97333112233");
        opted_out.enabled = false;
        let (recipients, excluded) = destinations(
            vec![customer(1, "33112233"), opted_out, customer(3, "")],
            "BH",
        );
        assert!(recipients.is_empty());
        assert_eq!(excluded.len(), 2);
        assert!(normalize("hello 123", "BH").is_none());
    }
}
