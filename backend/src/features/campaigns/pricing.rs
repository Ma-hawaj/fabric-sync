//! Meta Cloud API marketing list prices, in ten-thousandths of one USD.
//!
//! Rate card effective 2026-10-01, verified 2026-11-14:
//! https://developers.facebook.com/docs/whatsapp/pricing/#rate-cards
//! Meta-authored PDF mirror (page 1):
//! https://www.gupshup.ai/resources/wp-content/uploads/2026/11/USD_Oct2026.pdf
//! Country mapping is from Meta's pricing-regions table on the pricing page.
//! Update rates, mapping and verification date together when Meta changes them.
use std::collections::BTreeMap;

use super::types::{CostBreakdown, CostEstimate};

fn market(country: phonenumber::country::Id) -> (&'static str, u128) {
    use phonenumber::country::Id::*;
    match country {
        AR => ("Argentina", 618),
        BD => ("Bangladesh", 732),
        BR => ("Brazil", 625),
        CL => ("Chile", 889),
        CO => ("Colombia", 125),
        EG => ("Egypt", 644),
        FR => ("France", 859),
        DE => ("Germany", 1365),
        HK => ("Hong Kong", 732),
        HU => ("Hungary", 860),
        IN => ("India", 118),
        ID => ("Indonesia", 411),
        IQ => ("Iraq", 341),
        IL => ("Israel", 353),
        IT => ("Italy", 795),
        KZ => ("Kazakhstan", 604),
        KW => ("Kuwait", 792),
        MY => ("Malaysia", 860),
        MX => ("Mexico", 397),
        MA => ("Morocco", 414),
        NP => ("Nepal", 732),
        NL => ("Netherlands", 1597),
        NG => ("Nigeria", 516),
        OM => ("Oman", 341),
        PK => ("Pakistan", 473),
        PE => ("Peru", 703),
        PL => ("Poland", 366),
        QA => ("Qatar", 341),
        RO => ("Romania", 860),
        RU => ("Russia", 802),
        SA => ("Saudi Arabia", 576),
        SG => ("Singapore", 732),
        LK => ("Sri Lanka", 732),
        ZA => ("South Africa", 379),
        ES => ("Spain", 707),
        TR => ("Turkey", 109),
        UA => ("Ukraine", 860),
        AE => ("United Arab Emirates", 576),
        GB => ("United Kingdom", 635),
        CA | US => ("North America", 250),
        DZ | AO | BJ | BW | BF | BI | CM | TD | CG | ER | ET | GA | GM | GH | GW | CI | KE | LS
        | LR | LY | MG | MW | ML | MR | MZ | NA | NE | RW | SN | SL | SO | SS | SD | SZ | TZ
        | TG | TN | UG | ZM | ZW => ("Rest of Africa", 225),
        AF | AU | KH | CN | JP | LA | MN | NZ | PG | PH | TW | TJ | TH | TM | UZ | VN => {
            ("Rest of Asia Pacific", 842)
        }
        AL | AM | AZ | BY | BG | HR | CZ | GE | GR | LV | LT | MD | MK | RS | SK | SI => {
            ("Rest of Central & Eastern Europe", 860)
        }
        BO | CR | DO | EC | SV | GT | HT | HN | JM | NI | PA | PY | PR | UY | VE => {
            ("Rest of Latin America", 740)
        }
        BH | JO | LB | YE => ("Rest of Middle East", 392),
        AT | BE | DK | FI | IE | NO | PT | SE | CH => ("Rest of Western Europe", 592),
        // Meta explicitly assigns recognized countries absent from its table to Other.
        _ => ("Other", 604),
    }
}

fn amount(units: u128) -> String {
    format!("{}.{:04}", units / 10_000, units % 10_000)
}

/// Call with the eligible, already deduplicated E.164 audience, never raw customers.
/// Integer arithmetic preserves sub-cent rates; unknown destinations are not free.
pub fn estimate<'a>(mobiles: impl Iterator<Item = &'a str>) -> CostEstimate {
    let mut groups = BTreeMap::new();
    let mut unpriced = 0;
    for mobile in mobiles {
        let country = phonenumber::parse(None, mobile)
            .ok()
            .filter(|number| number.is_valid())
            .and_then(|number| number.country().id());
        if let Some(country) = country {
            let (name, rate) = market(country);
            let count = groups.entry((name, rate)).or_insert(0_usize);
            *count += 1;
        } else {
            unpriced += 1;
        }
    }
    let mut total = 0;
    let breakdown = groups
        .into_iter()
        .map(|((name, rate), count)| {
            let subtotal = rate * count as u128;
            total += subtotal;
            CostBreakdown {
                market: name.into(),
                message_count: count,
                unit_price: amount(rate),
                subtotal: amount(subtotal),
            }
        })
        .collect();
    CostEstimate {
        currency: "USD".into(),
        total: (unpriced == 0).then(|| amount(total)),
        priced_subtotal: amount(total),
        unpriced_message_count: unpriced,
        rate_card_effective_from: "2026-10-01".into(),
        rate_card_verified_on: "2026-11-14".into(),
        source_url: "https://developers.facebook.com/docs/whatsapp/pricing/#rate-cards".into(),
        breakdown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_without_rounding_each_message_to_cents() {
        let result = estimate(std::iter::repeat_n("+97333112233", 1000));
        assert_eq!(result.total.as_deref(), Some("39.2000"));
        assert_eq!(result.breakdown[0].unit_price, "0.0392");
        assert_eq!(result.breakdown[0].message_count, 1000);
        assert_eq!(result.breakdown[0].subtotal, "39.2000");
        let empty = estimate(std::iter::empty());
        assert_eq!(empty.total.as_deref(), Some("0.0000"));
        assert!(empty.breakdown.is_empty());
    }

    #[test]
    fn resolves_shared_calling_codes_and_new_standalone_markets() {
        let estimate = estimate(
            [
                "+97333112233", // Bahrain
                "+96550012345", // Kuwait, now standalone
                "+96892123456", // Oman, now standalone
                "+14155552671", // US
                "+17875551234", // Puerto Rico, not North America
                "+77011234567", // Kazakhstan, not Russia
                "+79123456789", // Russia
            ]
            .into_iter(),
        );
        assert_eq!(estimate.unpriced_message_count, 0);
        assert_eq!(estimate.total.as_deref(), Some("0.3921"));
        let markets: Vec<_> = estimate
            .breakdown
            .iter()
            .map(|b| b.market.as_str())
            .collect();
        assert_eq!(
            markets,
            [
                "Kazakhstan",
                "Kuwait",
                "North America",
                "Oman",
                "Rest of Latin America",
                "Rest of Middle East",
                "Russia"
            ]
        );
    }

    #[test]
    fn recognized_other_countries_are_priced_but_unknown_destinations_are_explicit() {
        let estimate = estimate(["+97333112233", "+80012340000", "invalid"].into_iter());
        assert_eq!(estimate.total, None);
        assert_eq!(estimate.priced_subtotal, "0.0392");
        assert_eq!(estimate.unpriced_message_count, 2);
        assert_eq!(market(phonenumber::country::Id::IS), ("Other", 604));
    }
}
