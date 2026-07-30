use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Built explicitly with `json_build_object` in repository.rs, so the JSON keys
// are already camelCase and a single symmetric rename_all works.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductLocationStock {
    pub location_id: Uuid,
    pub location: String,
    pub quantity: f64,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: Uuid,
    pub name: String,
    pub sku: Option<String>,
    /// Unlike a material, a product sells at a list price — the invoice form
    /// prefills a line from it rather than making staff type one in.
    pub unit_price: f64,
    pub is_active: bool,
    #[sqlx(json)]
    pub locations: Vec<ProductLocationStock>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockEntryInput {
    pub location_id: Uuid,
    pub quantity: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProductInput {
    pub name: String,
    pub sku: Option<String>,
    #[serde(default)]
    pub unit_price: f64,
    #[serde(default)]
    pub entries: Vec<StockEntryInput>,
}

/// Every field is optional so the same endpoint serves the edit form (which
/// sends all of them) and the list page's deactivate action (which sends only
/// `isActive`).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProductInput {
    pub name: Option<String>,
    pub sku: Option<String>,
    pub unit_price: Option<f64>,
    pub is_active: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStockInput {
    pub entries: Vec<StockEntryInput>,
}
