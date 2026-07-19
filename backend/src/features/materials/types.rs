use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Built explicitly with `json_build_object` in repository.rs (rather than
// `to_jsonb` over a whole row), so the JSON keys are already camelCase and
// this can use a single symmetric rename_all, unlike Measurement.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialLocationStock {
    pub location_id: Uuid,
    pub location: String,
    pub quantity: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: Uuid,
    pub name: String,
    pub sku: Option<String>,
    pub unit: String,
    pub locations: Vec<MaterialLocationStock>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockEntryInput {
    pub location_id: Uuid,
    pub quantity: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMaterialInput {
    pub name: String,
    pub sku: Option<String>,
    pub unit: String,
    #[serde(default)]
    pub entries: Vec<StockEntryInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStockInput {
    pub entries: Vec<StockEntryInput>,
}
