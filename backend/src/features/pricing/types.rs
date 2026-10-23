use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UrgentChargeUnit {
    Amount,
    Percent,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct UrgentChargeRule {
    pub amount: f64,
    pub unit: UrgentChargeUnit,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub urgent_charge: Option<UrgentChargeRule>,
}
