use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::features::customers::types::CreateMeasurementInput;

// Deliberately not tied to a specific currency code — a flat amount in
// whatever the business currency is, or a percentage of the subtotal.
#[derive(Clone, Copy, Debug, Deserialize)]
pub enum DiscountUnit {
    #[serde(rename = "amount")]
    Amount,
    #[serde(rename = "percent")]
    Percent,
}

impl DiscountUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Amount => "amount",
            Self::Percent => "percent",
        }
    }
}

// How a payment was actually made. An invoice is settled through any number
// of payments — advances at creation, per-pickup payments as orders are
// collected, till payments in between — each recording its own `PaymentType`
// as a row in `invoice_payments`.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaymentType {
    Benefit,
    Cash,
    Card,
}

impl PaymentType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Benefit => "benefit",
            Self::Cash => "cash",
            Self::Card => "card",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    pub material_id: Uuid,
    pub material_amount: f64,
    // Where material_amount comes off — material_stock is per-location, so an
    // order has to name one, the same way a product line names a branch_id.
    // Stored directly as orders.production_branch_id, so production location
    // is known from creation rather than left for staff to assign later.
    pub production_location_id: Uuid,
    // Entered by staff per order line; materials carry no unit price to derive
    // it from.
    pub price: f64,
    pub thobe_type: Option<String>,
    pub f_pocket: Option<String>,
    pub collar: Option<String>,
    pub sleeve: Option<String>,
    pub patti: Option<String>,
    pub more_details: Option<String>,
}

/// A retail line: a product sold as-is. Unlike an order it has no measurement
/// and no material behind it, which is why it lands in `invoice_items` rather
/// than `orders`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProductLineInput {
    pub product_id: Uuid,
    pub quantity: f64,
    // Snapshot of the product's list price at the time of sale; the client
    // prefills it from the catalog, but staff can override it per line.
    pub unit_price: f64,
    // Which location the stock comes off — product_stock is per-location, so a
    // sale has to name one.
    pub branch_id: Uuid,
}

/// A gift card sold on this invoice. Selling stored value is not a taxable
/// supply — VAT is charged when the card is spent — so the amount is added to
/// the total outside the VAT base.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGiftCardLineInput {
    pub code: String,
    pub amount: f64,
    #[serde(default)]
    pub expires_on: Option<NaiveDate>,
}

/// A gift card spent on this invoice. Tender rather than a discount, so it is
/// applied after VAT and does not change `total_price`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardRedemptionInput {
    pub code: String,
    pub amount: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCustomerInput {
    pub name: String,
    pub mobile_no: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceCustomerInput {
    // Exactly one of these two must be set: reference an existing customer or
    // create a new one as part of the invoice.
    #[serde(default)]
    pub existing_customer_id: Option<Uuid>,
    #[serde(default)]
    pub new_customer: Option<NewCustomerInput>,
    // Saving an invoice always records a fresh measurement snapshot (orders
    // reference it), even when every field was left blank.
    pub measurement: CreateMeasurementInput,
    pub orders: Vec<CreateOrderInput>,
}

/// One payment taken with the invoice: an advance collected up front. Later
/// payments go through `POST /invoices/:id/payments` or the receive
/// endpoints, which is why this carries no `order_id`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentInput {
    pub amount: f64,
    pub payment_type: PaymentType,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceInput {
    pub date: NaiveDate,
    #[serde(default)]
    pub branch_id: Option<Uuid>,
    #[serde(default)]
    pub discount: f64,
    pub discount_unit: DiscountUnit,
    // Payments taken up front, in the order they were taken. May be empty;
    // the sum must not exceed what the invoice charges (validated in
    // service.rs).
    #[serde(default)]
    pub payments: Vec<CreatePaymentInput>,
    // A tailoring invoice finds its customer through its orders; a sale of only
    // products or gift cards has none to go through, so the buyer is named
    // directly here instead.
    #[serde(default)]
    pub customer_id: Option<Uuid>,
    // Defaulted rather than required: an invoice may now consist entirely of
    // products or gift cards, with no customer block at all.
    #[serde(default)]
    pub customers: Vec<InvoiceCustomerInput>,
    #[serde(default)]
    pub products: Vec<CreateProductLineInput>,
    #[serde(default)]
    pub gift_cards: Vec<CreateGiftCardLineInput>,
    #[serde(default)]
    pub gift_card_redemptions: Vec<GiftCardRedemptionInput>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvoice {
    pub id: Uuid,
    pub total_price: f64,
    // Echoed back so the client can confirm how much gift card tender was
    // actually applied against the total.
    pub gift_card_redeemed: f64,
}

/// One tailoring line as it was entered, not as it prints: ids rather than
/// names, so the edit form can put every picker back the way it was.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEditOrder {
    pub material_id: Uuid,
    pub material_name: String,
    /// The unit the availability hint prints ("Available: X meters").
    pub material_unit: String,
    pub material_amount: f64,
    pub production_location_id: Option<Uuid>,
    pub production_location_name: Option<String>,
    /// Live stock at the production location, so the edit form can seed the
    /// "Made At" picker without a second query. Informational only — the
    /// guarded decrement on save is what actually enforces availability.
    pub stock_quantity: Option<f64>,
    pub price: f64,
    pub thobe_type: Option<String>,
    pub f_pocket: Option<String>,
    pub collar: Option<String>,
    pub sleeve: Option<String>,
    pub patti: Option<String>,
    pub more_details: Option<String>,
}

/// One customer block as it was entered: the measurement snapshot behind the
/// block plus the orders cut to it. `measurement_id` is the row an edit
/// rewrites in place (see service::update_invoice).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEditCustomer {
    pub existing_customer_id: Uuid,
    pub customer_name: String,
    pub customer_mobile_no: String,
    pub measurement_id: Option<Uuid>,
    pub measurement: CreateMeasurementInput,
    pub orders: Vec<InvoiceEditOrder>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEditProductLine {
    pub product_id: Option<Uuid>,
    pub product_name: String,
    pub quantity: f64,
    pub unit_price: f64,
    pub branch_id: Option<Uuid>,
    pub branch_name: Option<String>,
    /// Live stock at that branch, for the same reason as the order's.
    pub stock_quantity: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEditGiftCardLine {
    pub code: String,
    pub amount: f64,
    pub expires_on: Option<NaiveDate>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEditRedemption {
    pub code: String,
    pub amount: f64,
}

/// One row of the payments ledger, newest last. `payment_type` is null only
/// on legacy rows imported without a recorded method.
#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePayment {
    pub id: Uuid,
    pub amount: f64,
    pub payment_type: Option<String>,
    pub paid_at: DateTime<Utc>,
    pub order_id: Option<Uuid>,
}

/// Shape of `GET /invoices/:id/edit`: the invoice as input values rather than
/// as a printed document. `GET /invoices/:id` keeps serving the display shape
/// — names without ids — which is why this is a separate type and endpoint.
///
/// An invoice with payments cannot be edited at all (see
/// service::update_invoice), so `payments` is informational here: the form
/// maps it back to its `payments` input only when it is empty.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceEdit {
    pub id: Uuid,
    /// Sequential and human-readable, unlike `id` — for the edit page title.
    pub invoice_number: i64,
    pub date: NaiveDate,
    pub branch_id: Option<Uuid>,
    pub branch_name: Option<String>,
    pub discount: f64,
    pub discount_unit: String,
    pub payments: Vec<InvoicePayment>,
    pub customer_id: Option<Uuid>,
    pub customers: Vec<InvoiceEditCustomer>,
    pub products: Vec<InvoiceEditProductLine>,
    pub gift_cards: Vec<InvoiceEditGiftCardLine>,
    pub gift_card_redemptions: Vec<InvoiceEditRedemption>,
}

// One row of GET /invoices. Deserialize is only used to decode the
// SQL-built JSON aggregate in repository.rs, whose keys are already
// camelCase, so a single symmetric rename_all works.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceListCustomer {
    pub name: String,
    pub mobile_no: String,
}

/// Body for `POST /invoices/:id/receive` — marks every order on the invoice
/// received and settles the remaining balance in one action, for when the
/// customer collects everything (and pays) at once rather than picking up
/// order lines individually (see features::orders::receive_order). Omitted
/// when nothing is left to pay — collecting a fully-paid invoice takes no
/// money.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveInvoiceInput {
    #[serde(default)]
    pub payment_type: Option<PaymentType>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedInvoice {
    pub id: Uuid,
    pub payment_status: String,
    pub amount_paid: f64,
    pub balance_due: f64,
    pub payment_method: Option<String>,
    /// Goods receipt, separate from money: true once no order on the invoice
    /// is still pending collection. Always true from the bulk-receive call,
    /// which marks every pending order.
    pub received: bool,
}

/// Body for `POST /invoices/:id/payments` — a till payment not tied to
/// collecting anything: an extra advance, or the remainder paid after every
/// order was already collected. `order_id` attributes it to a pickup when it
/// was taken at one; it must belong to this invoice.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPaymentInput {
    pub amount: f64,
    pub payment_type: PaymentType,
    #[serde(default)]
    pub order_id: Option<Uuid>,
}

/// The invoice's money state after a payment landed. Returned alongside the
/// recorded payment so the client can update its balances without refetching.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSummary {
    pub payment_status: String,
    pub amount_paid: f64,
    pub balance_due: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedPayment {
    pub payment: InvoicePayment,
    pub summary: PaymentSummary,
}

/// A person named on the invoice — the buyer, or the customer a tailoring
/// line was measured for.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceParty {
    pub name: String,
    pub mobile_no: String,
}

/// What kind of line this is. Tailoring orders and `invoice_items` rows are
/// two different tables with two different shapes, but a printed invoice lists
/// them in one table, so they are flattened into a single line type here and
/// keep only this tag to distinguish them.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceLineKind {
    Order,
    Product,
    GiftCard,
}

/// One printed line. `quantity` is metres of material for an order and a unit
/// count for a product; `unit` says which.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetailLine {
    pub kind: InvoiceLineKind,
    /// Only set for an `Order` line — lets the frontend link straight to that
    /// order's tracking. `None` for a product or gift card line, which has no
    /// corresponding `orders` row.
    pub order_id: Option<Uuid>,
    pub description: String,
    /// The made-to-measure specification (thobe type, collar, sleeve…),
    /// already joined into one human-readable string. `None` for retail lines.
    pub detail: Option<String>,
    /// Who the garment is for. An invoice can carry orders for several
    /// customers, so the line names its own rather than relying on a header.
    pub customer: Option<InvoiceParty>,
    pub quantity: f64,
    pub unit: Option<String>,
    pub unit_price: f64,
    pub line_total: f64,
    /// False only for gift card sales — selling stored value is not a taxable
    /// supply, so the document has to be able to mark the line as excluded.
    pub taxable: bool,
    /// The raw design choices the order line was created with, so the printed
    /// document can render one chip per slot. Skipped from the REST payload —
    /// the app UI reads `detail`; only the HTML document wants the values
    /// broken out per slot. `None` for a retail line, which has none.
    #[serde(skip)]
    pub design_values: Option<OrderDesignValues>,
}

/// One order line's per-slot design values as stored in `orders`. Kept
/// separate from `detail` (one pre-joined string for the REST payload) because
/// the printed invoice shows each choice as its own chip, and nothing the
/// document needs should be re-derived from a string.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDesignValues {
    pub thobe_type: Option<String>,
    pub collar: Option<String>,
    pub sleeve: Option<String>,
    pub f_pocket: Option<String>,
    pub patti: Option<String>,
    /// The free-text line note. Not a design slot; printed beneath the chips.
    pub more_details: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRedemptionLine {
    pub code: String,
    pub amount: f64,
}

/// The arithmetic behind `invoices.total_price`, spelled out. The table stores
/// only the final total, the discount and its unit, so everything between the
/// line items and the total has to be derived — see service::breakdown, which
/// is shared with the create path so the printed figures and the stored total
/// can't drift apart.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceTotalsBreakdown {
    pub subtotal: f64,
    pub discount: f64,
    pub discount_unit: String,
    pub discount_amount: f64,
    pub taxable: f64,
    pub vat_rate: f64,
    pub vat: f64,
    pub gift_card_sales: f64,
    pub total: f64,
    pub gift_card_redeemed: f64,
    pub amount_paid: f64,
    /// What the customer still owes: the total less everything already
    /// settled, whether in cash or in gift card tender.
    pub balance_due: f64,
}

/// The invoice row itself, before the lines and totals are assembled onto it.
/// Internal to the read path — the repository returns this, the service turns
/// it into an `InvoiceDetail`. `payment_status`, `amount_paid` and
/// `payment_method` are derived from the payments ledger in the query, since
/// the table no longer stores them.
#[derive(Clone, Debug)]
pub struct InvoiceRecord {
    pub id: Uuid,
    pub invoice_number: i64,
    pub date: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub branch_name: Option<String>,
    pub buyer: Option<InvoiceParty>,
    pub discount: f64,
    pub discount_unit: String,
    pub payment_status: String,
    pub total_price: f64,
    pub amount_paid: f64,
    pub payment_method: Option<String>,
    /// Goods receipt, separate from money: true once no order on the invoice
    /// is still pending collection.
    pub received: bool,
    pub gift_card_redeemed: f64,
}

/// Shape of `GET /invoices/:id`, and the context the invoice document template
/// renders from.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetail {
    pub id: Uuid,
    /// Sequential and human-readable, unlike `id`. Formatted for display by
    /// the consumer, which is why it stays a number here.
    pub invoice_number: i64,
    pub date: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub branch_name: Option<String>,
    /// Named directly on a retail sale. A tailoring invoice leaves this unset
    /// and finds its customers through the lines instead.
    pub buyer: Option<InvoiceParty>,
    pub payment_status: String,
    /// The method of the most recent payment, for the document header. The
    /// full history is in `payments`.
    pub payment_method: Option<String>,
    /// Goods receipt, separate from money: true once no order on the invoice
    /// is still pending collection. The edit form and the receive actions
    /// both read this rather than inferring it from the payment status.
    pub received: bool,
    pub lines: Vec<InvoiceDetailLine>,
    pub redemptions: Vec<InvoiceRedemptionLine>,
    pub payments: Vec<InvoicePayment>,
    pub totals: InvoiceTotalsBreakdown,
}

#[derive(Clone, Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceListItem {
    pub id: Uuid,
    #[sqlx(rename = "invoice_date")]
    pub date: NaiveDate,
    #[sqlx(json)]
    pub customers: Vec<InvoiceListCustomer>,
    pub item_count: i64,
    #[sqlx(json)]
    pub materials: Vec<String>,
    pub total_price: f64,
    pub payment_status: String,
    pub amount_paid: f64,
    /// What the customer still owes: the total less gift card tender and
    /// every payment. Display-only — the dialogs collect against it.
    pub balance_due: f64,
    /// The method of the most recent payment, backing the list's payment
    /// method column.
    pub payment_method: Option<String>,
    /// Goods receipt, separate from money: true once no order on the invoice
    /// is still pending collection. Backs the list's collection filter.
    pub received: bool,
    /// Gift card tender applied to this invoice. Not part of `amount_paid`:
    /// together they add up to `total_price` on a settled invoice.
    pub gift_card_redeemed: f64,
}
