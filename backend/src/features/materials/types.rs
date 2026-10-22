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

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub id: Uuid,
    pub name: String,
    pub sku: Option<String>,
    pub unit: String,
    // Fabric family shared by a fabric's colour variants ("Zabrjad 1" and
    // "Zabrjad 2" are both family "Zabrjad"); NULL on pre-existing rows.
    pub family: Option<String>,
    pub junior_price: Option<f64>,
    pub normal_price: Option<f64>,
    pub large_price: Option<f64>,
    #[sqlx(json)]
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
    // Fabric family grouping this material's colour variants; absent on
    // older clients, which simply create ungrouped materials.
    pub family: Option<String>,
    #[serde(flatten)]
    pub prices: MaterialPrices,
    #[serde(default)]
    pub entries: Vec<StockEntryInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPrices {
    pub junior_price: f64,
    pub normal_price: f64,
    pub large_price: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStockInput {
    pub entries: Vec<StockEntryInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMaterialInput {
    pub name: String,
    pub sku: Option<String>,
    pub unit: String,
    pub family: Option<String>,
    #[serde(flatten)]
    pub prices: MaterialPrices,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStockInput {
    pub from_location_id: Uuid,
    pub to_location_id: Uuid,
    pub quantity: f64,
}
