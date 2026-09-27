use uuid::Uuid;

use crate::{
    error::AppError,
    list::{self, ColumnDef, ColumnKind, ListParams, ListSpec},
    state::AppState,
};

use super::types::{
    CreateInvoiceInput, CreateOrderInput, CreateProductLineInput, InvoiceDetailLine, InvoiceEdit,
    InvoiceEditCustomer, InvoiceEditGiftCardLine, InvoiceEditOrder, InvoiceEditProductLine,
    InvoiceEditRedemption, InvoiceLineKind, InvoiceListItem, InvoiceParty, InvoiceRecord,
    InvoiceRedemptionLine, OrderDesignValues, PaymentType, ReceivedInvoice,
};
use crate::features::customers::types::CreateMeasurementInput;

/// Everything `GET /invoices/:id` reads, before the totals are worked out.
pub struct InvoiceDetailRows {
    pub invoice: InvoiceRecord,
    pub lines: Vec<InvoiceDetailLine>,
    pub redemptions: Vec<InvoiceRedemptionLine>,
}

/// The made-to-measure specification, as one line of prose. Every field is
/// optional and most orders set only some, so the blanks are dropped rather
/// than printed as empty labels.
fn order_specification(
    thobe_type: Option<String>,
    f_pocket: Option<String>,
    collar: Option<String>,
    sleeve: Option<String>,
    patti: Option<String>,
    more_details: Option<String>,
) -> Option<String> {
    let parts: Vec<String> = [
        ("Thobe", thobe_type),
        ("Pocket", f_pocket),
        ("Collar", collar),
        ("Sleeve", sleeve),
        ("Patti", patti),
        ("Note", more_details),
    ]
    .into_iter()
    .filter_map(|(label, value)| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| format!("{label}: {value}"))
    })
    .collect();

    (!parts.is_empty()).then(|| parts.join(" · "))
}

pub async fn fetch_invoice_detail(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Option<InvoiceDetailRows>, sqlx::Error> {
    let Some(invoice) = sqlx::query!(
        r#"
        SELECT
            i.id,
            i.invoice_number,
            i.invoice_date,
            i.created_at,
            i.discount::float8 AS "discount!",
            i.discount_unit,
            i.payment_status,
            i.total_price::float8 AS "total_price!",
            i.amount_paid::float8 AS "amount_paid!",
            i.advance_amount::float8 AS "advance_amount!",
            i.advance_payment_type,
            i.final_payment_type,
            i.gift_card_redeemed::float8 AS "gift_card_redeemed!",
            -- The `?` suffixes are for sqlx: it reads nullability off the
            -- column definition, which says NOT NULL, and can't see that a
            -- LEFT JOIN may not match.
            b.name AS "branch_name?",
            c.name AS "buyer_name?",
            c.mobile_no AS "buyer_mobile_no?"
        FROM invoices i
        LEFT JOIN branch b ON b.id = i.branch_id
        LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = $1
        "#,
        invoice_id,
    )
    .fetch_optional(state.db())
    .await?
    else {
        return Ok(None);
    };

    // Tailoring lines. Ordered by id, which is uuidv7, so lines print in the
    // order they were entered on the form.
    let orders = sqlx::query!(
        r#"
        SELECT
            o.id AS order_id,
            c.name AS customer_name,
            c.mobile_no AS customer_mobile_no,
            mat.name AS material_name,
            mat.unit AS material_unit,
            o.material_amount::float8 AS "material_amount!",
            o.price::float8 AS "price!",
            o.thobe_type,
            o.f_pocket,
            o.collar,
            o.sleeve,
            o.patti,
            o.more_details
        FROM orders o
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
        WHERE o.invoice_id = $1
        ORDER BY o.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    let items = sqlx::query!(
        r#"
        SELECT
            kind,
            description,
            quantity::float8 AS "quantity!",
            unit_price::float8 AS "unit_price!",
            line_total::float8 AS "line_total!"
        FROM invoice_items
        WHERE invoice_id = $1
        ORDER BY id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    let redemptions = sqlx::query!(
        r#"
        SELECT g.code, r.amount::float8 AS "amount!"
        FROM gift_card_redemptions r
        JOIN gift_cards g ON g.id = r.gift_card_id
        WHERE r.invoice_id = $1
        ORDER BY r.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    let mut lines: Vec<InvoiceDetailLine> = orders
        .into_iter()
        .map(|row| {
            // The document needs the per-slot values to render chips and the
            // REST payload a single joined string (order_specification), so
            // build both from one source of truth rather than copying.
            let design_values = OrderDesignValues {
                thobe_type: row.thobe_type,
                collar: row.collar,
                sleeve: row.sleeve,
                f_pocket: row.f_pocket,
                patti: row.patti,
                more_details: row.more_details,
            };
            InvoiceDetailLine {
                kind: InvoiceLineKind::Order,
                order_id: Some(row.order_id),
                description: row.material_name,
                detail: order_specification(
                    design_values.thobe_type.clone(),
                    design_values.f_pocket.clone(),
                    design_values.collar.clone(),
                    design_values.sleeve.clone(),
                    design_values.patti.clone(),
                    design_values.more_details.clone(),
                ),
                customer: Some(InvoiceParty {
                    name: row.customer_name,
                    mobile_no: row.customer_mobile_no,
                }),
                quantity: row.material_amount,
                unit: Some(row.material_unit),
                // An order is priced as a whole line, not per metre, so there is
                // no per-unit figure to print: the material amount is what was
                // consumed, not what was charged for.
                unit_price: row.price,
                line_total: row.price,
                taxable: true,
                design_values: Some(design_values),
            }
        })
        .collect();

    lines.extend(items.into_iter().map(|row| {
        let is_gift_card = row.kind == "gift_card";
        InvoiceDetailLine {
            kind: if is_gift_card {
                InvoiceLineKind::GiftCard
            } else {
                InvoiceLineKind::Product
            },
            order_id: None,
            description: row.description,
            detail: None,
            customer: None,
            quantity: row.quantity,
            unit: None,
            unit_price: row.unit_price,
            line_total: row.line_total,
            taxable: !is_gift_card,
            design_values: None,
        }
    }));

    Ok(Some(InvoiceDetailRows {
        invoice: InvoiceRecord {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            date: invoice.invoice_date,
            created_at: invoice.created_at,
            branch_name: invoice.branch_name,
            buyer: invoice
                .buyer_name
                .zip(invoice.buyer_mobile_no)
                .map(|(name, mobile_no)| InvoiceParty { name, mobile_no }),
            discount: invoice.discount,
            discount_unit: invoice.discount_unit,
            payment_status: invoice.payment_status,
            total_price: invoice.total_price,
            amount_paid: invoice.amount_paid,
            advance_amount: invoice.advance_amount,
            advance_payment_type: invoice.advance_payment_type,
            final_payment_type: invoice.final_payment_type,
            gift_card_redeemed: invoice.gift_card_redeemed,
        },
        lines,
        redemptions: redemptions
            .into_iter()
            .map(|row| InvoiceRedemptionLine {
                code: row.code,
                amount: row.amount,
            })
            .collect(),
    }))
}

// The laterals already produce one row per invoice, so the shared wrapper's
// `LIMIT` counts invoices. Alongside the JSON the page renders, each aggregate
// also emits a flat form — `customer_names` as text, `material_names` as
// `text[]` — because a JSON array cannot be filtered or sorted on directly and
// those are exactly the columns the invoices table offers a filter for.
const SPEC: ListSpec = ListSpec {
    base_sql: r#"
        SELECT
            i.id,
            i.invoice_date,
            i.payment_status,
            i.total_price::float8 AS total_price,
            i.amount_paid::float8 AS amount_paid,
            i.advance_amount::float8 AS advance_amount,
            i.advance_payment_type,
            i.final_payment_type,
            i.gift_card_redeemed::float8 AS gift_card_redeemed,
            COALESCE(i.final_payment_type, i.advance_payment_type) AS payment_method,
            COALESCE(agg.item_count, 0) + COALESCE(items.item_count, 0) AS item_count,
            COALESCE(
                agg.customers,
                CASE
                    WHEN ic.id IS NOT NULL THEN json_build_array(jsonb_build_object(
                        'name', ic.name,
                        'mobileNo', ic.mobile_no
                    ))
                END,
                '[]'
            ) AS customers,
            COALESCE(agg.materials, '[]') AS materials,
            COALESCE(
                agg.customer_names,
                CASE WHEN ic.id IS NOT NULL THEN ic.name END,
                ''
            ) AS customer_names,
            COALESCE(
                agg.customer_mobiles,
                CASE WHEN ic.id IS NOT NULL THEN ic.mobile_no END,
                ''
            ) AS customer_mobiles,
            COALESCE(agg.material_names, ARRAY[]::text[]) AS material_names
        FROM invoices i
        LEFT JOIN LATERAL (
            SELECT
                count(*) AS item_count,
                json_agg(DISTINCT jsonb_build_object(
                    'name', c.name,
                    'mobileNo', c.mobile_no
                )) AS customers,
                json_agg(DISTINCT mat.name) AS materials,
                string_agg(DISTINCT c.name, ', ') AS customer_names,
                string_agg(DISTINCT c.mobile_no, ', ') AS customer_mobiles,
                array_agg(DISTINCT mat.name) AS material_names
            FROM orders o
            JOIN measurements m ON m.id = o.measurement_id
            JOIN customers c ON c.id = m.customer_id
            JOIN materials mat ON mat.id = o.material_id
            WHERE o.invoice_id = i.id
        ) agg ON true
        -- Product and gift card lines live in their own table, so they need a
        -- second aggregate to be counted alongside the tailoring orders.
        LEFT JOIN LATERAL (
            SELECT count(*) AS item_count
            FROM invoice_items ii
            WHERE ii.invoice_id = i.id
        ) items ON true
        -- Falls back to the invoice's own customer when there are no orders to
        -- derive one from, which is the case for a pure retail sale.
        LEFT JOIN customers ic ON ic.id = i.customer_id
    "#,
    columns: &[
        ("id", ColumnDef::new("id", ColumnKind::Uuid)),
        ("date", ColumnDef::new("invoice_date", ColumnKind::Date)),
        (
            "customerName",
            ColumnDef::new("customer_names", ColumnKind::Text),
        ),
        (
            "customerMobile",
            ColumnDef::new("customer_mobiles", ColumnKind::Text),
        ),
        (
            "materials",
            ColumnDef::new("material_names", ColumnKind::TextArray),
        ),
        (
            "itemCount",
            ColumnDef::new("item_count", ColumnKind::Number),
        ),
        (
            "totalPrice",
            ColumnDef::new("total_price", ColumnKind::Number),
        ),
        (
            "amountPaid",
            ColumnDef::new("amount_paid", ColumnKind::Number),
        ),
        (
            "paymentStatus",
            ColumnDef::new("payment_status", ColumnKind::Text),
        ),
        (
            "paymentMethod",
            ColumnDef::new("payment_method", ColumnKind::Text),
        ),
    ],
    default_order: "id DESC",
};

pub async fn list_invoices(
    state: &AppState,
    params: &ListParams,
) -> Result<list::Page<InvoiceListItem>, AppError> {
    list::fetch_page(state.db(), &SPEC, params).await
}

pub async fn insert_invoice(
    tx: &mut sqlx::PgTransaction<'_>,
    input: &CreateInvoiceInput,
    total_price: f64,
    gift_card_redeemed: f64,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        INSERT INTO invoices (
            invoice_date, branch_id, discount, discount_unit,
            payment_status, amount_paid, total_price,
            advance_amount, advance_payment_type,
            customer_id, gift_card_redeemed
        )
        VALUES (
            $1, $2, $3::float8, $4, $5, $6::float8, $7::float8,
            $6::float8, $8, $9, $10::float8
        )
        RETURNING id
        "#,
        input.date,
        input.branch_id,
        input.discount,
        input.discount_unit.as_str(),
        input.payment_status.as_str(),
        input.amount_paid,
        total_price,
        input.payment_type.map(PaymentType::as_str),
        input.customer_id,
        gift_card_redeemed,
    )
    .fetch_one(&mut **tx)
    .await
}

/// Marks every order on the invoice received and settles the remaining
/// balance in full, recording how that final payment was made. Returns
/// `None` if the invoice doesn't exist.
///
/// The balance settled is `total_price - gift_card_redeemed`, not the whole
/// total: a gift card already paid its share at invoice time, so charging it
/// again here would overstate what was actually collected.
pub async fn receive_invoice(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    final_payment_type: PaymentType,
) -> Result<Option<ReceivedInvoice>, sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE orders
        SET status = 'received', received_at = now()
        WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .execute(&mut **tx)
    .await?;

    let row = sqlx::query!(
        r#"
        UPDATE invoices
        SET amount_paid = total_price - gift_card_redeemed,
            payment_status = 'paid',
            final_payment_type = $2
        WHERE id = $1
        RETURNING id, payment_status, amount_paid::float8 AS "amount_paid!", final_payment_type
        "#,
        invoice_id,
        final_payment_type.as_str(),
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(|row| ReceivedInvoice {
        id: row.id,
        payment_status: row.payment_status,
        amount_paid: row.amount_paid,
        final_payment_type: row.final_payment_type,
    }))
}

pub async fn insert_order(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    measurement_id: Uuid,
    order: &CreateOrderInput,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO orders (
            measurement_id, material_id, material_amount, invoice_id, price,
            thobe_type, f_pocket, collar, sleeve, patti, more_details,
            production_branch_id
        )
        VALUES ($1, $2, $3::float8, $4, $5::float8, $6, $7, $8, $9, $10, $11, $12)
        "#,
        measurement_id,
        order.material_id,
        order.material_amount,
        invoice_id,
        order.price,
        order.thobe_type,
        order.f_pocket,
        order.collar,
        order.sleeve,
        order.patti,
        order.more_details,
        order.production_location_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// `description` is stored rather than joined at read time so a line keeps the
// name the product was sold under, even if the catalog entry is renamed later.
pub async fn insert_product_item(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    line: &CreateProductLineInput,
    description: &str,
    line_total: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO invoice_items (
            invoice_id, kind, product_id, branch_id,
            description, quantity, unit_price, line_total
        )
        VALUES ($1, 'product', $2, $3, $4, $5::float8, $6::float8, $7::float8)
        "#,
        invoice_id,
        line.product_id,
        line.branch_id,
        description,
        line.quantity,
        line.unit_price,
        line_total,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn insert_gift_card_item(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    gift_card_id: Uuid,
    description: &str,
    amount: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO invoice_items (
            invoice_id, kind, gift_card_id,
            description, quantity, unit_price, line_total
        )
        VALUES ($1, 'gift_card', $2, $3, 1, $4::float8, $4::float8)
        "#,
        invoice_id,
        gift_card_id,
        description,
        amount,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Old tailoring lines, for restoring the material they consumed.
pub struct OldOrderLine {
    pub material_id: Uuid,
    pub production_branch_id: Option<Uuid>,
    pub material_amount: f64,
}

/// Old retail lines, for restoring the product stock they consumed.
pub struct OldProductLine {
    pub product_id: Option<Uuid>,
    pub branch_id: Option<Uuid>,
    pub quantity: f64,
}

/// A gift card this invoice sold, with the row to delete if the edit drops it.
pub struct OldGiftCardSale {
    pub gift_card_id: Uuid,
    pub code: String,
}

/// Gift card tender this invoice spent, for paying the balance back.
pub struct OldRedemption {
    pub gift_card_id: Uuid,
    pub amount: f64,
}

/// A measurement row this invoice's orders point at, with the customer it was
/// taken for. The update matches these against the edited blocks to decide
/// which rows to rewrite in place.
pub struct OldMeasurementRef {
    pub measurement_id: Uuid,
    pub customer_id: Uuid,
}

pub async fn fetch_invoice_edit(
    state: &AppState,
    invoice_id: Uuid,
) -> Result<Option<InvoiceEdit>, sqlx::Error> {
    let Some(header) = sqlx::query!(
        r#"
        SELECT
            i.invoice_number,
            i.invoice_date,
            i.branch_id,
            b.name AS "branch_name?",
            i.discount::float8 AS "discount!",
            i.discount_unit,
            i.payment_status,
            i.amount_paid::float8 AS "amount_paid!",
            i.advance_payment_type,
            i.customer_id
        FROM invoices i
        LEFT JOIN branch b ON b.id = i.branch_id
        WHERE i.id = $1
        "#,
        invoice_id,
    )
    .fetch_optional(state.db())
    .await?
    else {
        return Ok(None);
    };

    // One row per order, carrying its block's customer and measurement along:
    // blocks are rebuilt app-side by grouping on (customer, measurement).
    let order_rows = sqlx::query!(
        r#"
        SELECT
            m.customer_id,
            c.name AS customer_name,
            c.mobile_no AS customer_mobile_no,
            m.id AS measurement_id,
            m.measurement_date,
            m.length_fl::float8 AS length_fl,
            m.length_bl::float8 AS length_bl,
            m.chest::float8 AS chest,
            m.waist::float8 AS waist,
            m.hips::float8 AS hips,
            m.shoulder::float8 AS shoulder,
            m.sleeve_length::float8 AS sleeve_length,
            m.neck::float8 AS neck,
            m.open_hand::float8 AS open_hand,
            m.chest_up::float8 AS chest_up,
            m.cuff_width::float8 AS cuff_width,
            m.neck_width::float8 AS neck_width,
            m.aram_hole::float8 AS aram_hole,
            m.fo_width::float8 AS fo_width,
            m.frant_pocket_length::float8 AS frant_pocket_length,
            m.farnt_pocket_length_by_width,
            m.side_pocket,
            m.mobile_pocket_length_by_width,
            o.material_id,
            mat.name AS material_name,
            mat.unit AS material_unit,
            o.material_amount::float8 AS "material_amount!",
            o.production_branch_id,
            b.name AS "production_location_name?",
            ms.quantity::float8 AS stock_quantity,
            o.price::float8 AS "price!",
            o.thobe_type,
            o.f_pocket,
            o.collar,
            o.sleeve,
            o.patti,
            o.more_details
        FROM orders o
        JOIN measurements m ON m.id = o.measurement_id
        JOIN customers c ON c.id = m.customer_id
        JOIN materials mat ON mat.id = o.material_id
        LEFT JOIN branch b ON b.id = o.production_branch_id
        LEFT JOIN material_stock ms
            ON ms.material_id = o.material_id
            AND ms.branch_id = o.production_branch_id
        WHERE o.invoice_id = $1
        ORDER BY o.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    // Grouped by (customer, measurement) the way the form's customer blocks
    // were entered: one measurement snapshot per block.
    let mut customers: Vec<InvoiceEditCustomer> = Vec::new();
    for row in order_rows {
        let measurement = CreateMeasurementInput {
            date: row.measurement_date,
            length_fl: row.length_fl,
            length_bl: row.length_bl,
            chest: row.chest,
            waist: row.waist,
            hips: row.hips,
            shoulder: row.shoulder,
            sleeve_length: row.sleeve_length,
            neck: row.neck,
            open_hand: row.open_hand,
            chest_up: row.chest_up,
            cuff_width: row.cuff_width,
            neck_width: row.neck_width,
            aram_hole: row.aram_hole,
            fo_width: row.fo_width,
            frant_pocket_length: row.frant_pocket_length,
            farnt_pocket_length_by_width: row.farnt_pocket_length_by_width,
            side_pocket: row.side_pocket,
            mobile_pocket_length_by_width: row.mobile_pocket_length_by_width,
        };
        let order = InvoiceEditOrder {
            material_id: row.material_id,
            material_name: row.material_name,
            material_unit: row.material_unit,
            material_amount: row.material_amount,
            production_location_id: row.production_branch_id,
            production_location_name: row.production_location_name,
            stock_quantity: row.stock_quantity,
            price: row.price,
            thobe_type: row.thobe_type,
            f_pocket: row.f_pocket,
            collar: row.collar,
            sleeve: row.sleeve,
            patti: row.patti,
            more_details: row.more_details,
        };

        match customers.iter_mut().find(|block| {
            block.existing_customer_id == row.customer_id
                && block.measurement_id == Some(row.measurement_id)
        }) {
            Some(block) => block.orders.push(order),
            None => customers.push(InvoiceEditCustomer {
                existing_customer_id: row.customer_id,
                customer_name: row.customer_name,
                customer_mobile_no: row.customer_mobile_no,
                measurement_id: Some(row.measurement_id),
                measurement,
                orders: vec![order],
            }),
        }
    }

    let product_rows = sqlx::query!(
        r#"
        SELECT
            ii.product_id,
            ii.description,
            ii.quantity::float8 AS "quantity!",
            ii.unit_price::float8 AS "unit_price!",
            ii.branch_id,
            b.name AS "branch_name?",
            ps.quantity::float8 AS stock_quantity
        FROM invoice_items ii
        LEFT JOIN branch b ON b.id = ii.branch_id
        LEFT JOIN product_stock ps
            ON ps.product_id = ii.product_id
            AND ps.branch_id = ii.branch_id
        WHERE invoice_id = $1 AND kind = 'product'
        ORDER BY ii.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    let gift_rows = sqlx::query!(
        r#"
        SELECT g.code, ii.line_total::float8 AS "amount!", g.expires_on
        FROM invoice_items ii
        JOIN gift_cards g ON g.id = ii.gift_card_id
        WHERE ii.invoice_id = $1 AND ii.kind = 'gift_card'
        ORDER BY ii.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    let redemption_rows = sqlx::query!(
        r#"
        SELECT g.code, r.amount::float8 AS "amount!"
        FROM gift_card_redemptions r
        JOIN gift_cards g ON g.id = r.gift_card_id
        WHERE r.invoice_id = $1
        ORDER BY r.id
        "#,
        invoice_id,
    )
    .fetch_all(state.db())
    .await?;

    Ok(Some(InvoiceEdit {
        id: invoice_id,
        invoice_number: header.invoice_number,
        date: header.invoice_date,
        branch_id: header.branch_id,
        branch_name: header.branch_name,
        discount: header.discount,
        discount_unit: header.discount_unit,
        payment_status: header.payment_status,
        amount_paid: header.amount_paid,
        payment_type: header.advance_payment_type,
        customer_id: header.customer_id,
        customers,
        products: product_rows
            .into_iter()
            .map(|row| InvoiceEditProductLine {
                product_id: row.product_id,
                product_name: row.description,
                quantity: row.quantity,
                unit_price: row.unit_price,
                branch_id: row.branch_id,
                branch_name: row.branch_name,
                stock_quantity: row.stock_quantity,
            })
            .collect(),
        gift_cards: gift_rows
            .into_iter()
            .map(|row| InvoiceEditGiftCardLine {
                code: row.code,
                amount: row.amount,
                expires_on: row.expires_on,
            })
            .collect(),
        gift_card_redemptions: redemption_rows
            .into_iter()
            .map(|row| InvoiceEditRedemption {
                code: row.code,
                amount: row.amount,
            })
            .collect(),
    }))
}

/// The locked invoice header an edit guards on. Read `FOR UPDATE` so two
/// concurrent edits serialize rather than both rebuilding the same lines.
pub struct InvoiceEditGuard {
    pub payment_status: String,
    pub final_payment_type: Option<String>,
}

pub async fn lock_invoice_for_edit(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Option<InvoiceEditGuard>, sqlx::Error> {
    sqlx::query_as!(
        InvoiceEditGuard,
        r#"
        SELECT payment_status, final_payment_type
        FROM invoices
        WHERE id = $1
        FOR UPDATE
        "#,
        invoice_id,
    )
    .fetch_optional(&mut **tx)
    .await
}

/// True once any order on the invoice has been collected.
pub async fn invoice_has_received_orders(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM orders
            WHERE invoice_id = $1 AND status = 'received'
        ) AS "exists!"
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await?)
}

/// True once production has touched any order on the invoice: a recorded
/// stage, an assignee, or a repair. Editing lines under that would rewrite
/// history the shop floor already acted on.
pub async fn invoice_has_production_activity(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM order_stage_progress p
            JOIN orders o ON o.id = p.order_id
            WHERE o.invoice_id = $1
        ) OR EXISTS(
            SELECT 1 FROM order_stage_assignments a
            JOIN orders o ON o.id = a.order_id
            WHERE o.invoice_id = $1
        ) OR EXISTS(
            SELECT 1 FROM order_repairs r
            JOIN orders o ON o.id = r.order_id
            WHERE o.invoice_id = $1
        ) AS "exists!"
        "#,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn old_order_lines(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<OldOrderLine>, sqlx::Error> {
    sqlx::query_as!(
        OldOrderLine,
        r#"
        SELECT material_id, production_branch_id, material_amount::float8 AS "material_amount!"
        FROM orders
        WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn old_product_lines(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<OldProductLine>, sqlx::Error> {
    sqlx::query_as!(
        OldProductLine,
        r#"
        SELECT product_id, branch_id, quantity::float8 AS "quantity!"
        FROM invoice_items
        WHERE invoice_id = $1 AND kind = 'product'
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn old_gift_card_sales(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<OldGiftCardSale>, sqlx::Error> {
    sqlx::query_as!(
        OldGiftCardSale,
        r#"
        SELECT g.id AS gift_card_id, g.code
        FROM invoice_items ii
        JOIN gift_cards g ON g.id = ii.gift_card_id
        WHERE ii.invoice_id = $1 AND ii.kind = 'gift_card'
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn old_redemptions(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<OldRedemption>, sqlx::Error> {
    sqlx::query_as!(
        OldRedemption,
        r#"
        SELECT gift_card_id, amount::float8 AS "amount!"
        FROM gift_card_redemptions
        WHERE invoice_id = $1
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

pub async fn old_measurement_refs(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<Vec<OldMeasurementRef>, sqlx::Error> {
    sqlx::query_as!(
        OldMeasurementRef,
        r#"
        SELECT DISTINCT o.measurement_id, m.customer_id
        FROM orders o
        JOIN measurements m ON m.id = o.measurement_id
        WHERE o.invoice_id = $1
        "#,
        invoice_id,
    )
    .fetch_all(&mut **tx)
    .await
}

/// True when no other invoice's orders point at this measurement: the row is
/// exclusively this invoice's to rewrite or delete.
pub async fn measurement_is_exclusive(
    tx: &mut sqlx::PgTransaction<'_>,
    measurement_id: Uuid,
    invoice_id: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(!sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM orders
            WHERE measurement_id = $1 AND invoice_id != $2
        ) AS "exists!"
        "#,
        measurement_id,
        invoice_id,
    )
    .fetch_one(&mut **tx)
    .await?)
}

/// True once a sold card has been spent anywhere — including on the invoice
/// that sold it. A spent card belongs to two invoices' histories, so it can
/// neither be deleted nor re-issued by an edit.
pub async fn sold_card_was_used(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_id: Uuid,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM gift_card_redemptions
            WHERE gift_card_id = $1
        ) AS "exists!"
        "#,
        gift_card_id,
    )
    .fetch_one(&mut **tx)
    .await?)
}

/// Locks the gift cards an edit is about to reverse, so a till redemption
/// can't land between the spent-check and the delete.
pub async fn lock_gift_cards(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        SELECT id FROM gift_cards
        WHERE id = ANY($1)
        FOR UPDATE
        "#,
        gift_card_ids,
    )
    .fetch_all(&mut **tx)
    .await?;

    Ok(())
}

// Restores are plain additions: the row must exist, since the guarded
// decrement that consumed it required one.
pub async fn restore_material_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    material_id: Uuid,
    branch_id: Uuid,
    amount: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE material_stock
        SET quantity = quantity + $3::float8
        WHERE material_id = $1 AND branch_id = $2
        "#,
        material_id,
        branch_id,
        amount,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn restore_product_stock(
    tx: &mut sqlx::PgTransaction<'_>,
    product_id: Uuid,
    branch_id: Uuid,
    quantity: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE product_stock
        SET quantity = quantity + $3::float8
        WHERE product_id = $1 AND branch_id = $2
        "#,
        product_id,
        branch_id,
        quantity,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Pays tender back onto the card when the redemption that spent it is
/// deleted.
pub async fn refund_gift_card(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_id: Uuid,
    amount: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE gift_cards
        SET balance = balance + $2::float8
        WHERE id = $1
        "#,
        gift_card_id,
        amount,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn delete_redemptions(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM gift_card_redemptions WHERE invoice_id = $1"#,
        invoice_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn delete_orders(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"DELETE FROM orders WHERE invoice_id = $1"#, invoice_id,)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

pub async fn delete_items(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM invoice_items WHERE invoice_id = $1"#,
        invoice_id,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn delete_gift_cards(
    tx: &mut sqlx::PgTransaction<'_>,
    gift_card_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM gift_cards WHERE id = ANY($1)"#,
        gift_card_ids,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn delete_measurements(
    tx: &mut sqlx::PgTransaction<'_>,
    measurement_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM measurements WHERE id = ANY($1)"#,
        measurement_ids,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// The in-place rewrite: same row id, corrected values. Only called for rows
// the exclusivity check proved belong to this invoice alone.
pub async fn update_measurement(
    tx: &mut sqlx::PgTransaction<'_>,
    measurement_id: Uuid,
    measurement: &CreateMeasurementInput,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE measurements
        SET measurement_date = $2,
            length_fl = $3::float8, length_bl = $4::float8,
            chest = $5::float8, waist = $6::float8,
            hips = $7::float8, shoulder = $8::float8,
            sleeve_length = $9::float8, neck = $10::float8,
            open_hand = $11::float8, chest_up = $12::float8,
            cuff_width = $13::float8, neck_width = $14::float8,
            aram_hole = $15::float8, fo_width = $16::float8,
            frant_pocket_length = $17::float8,
            farnt_pocket_length_by_width = $18, side_pocket = $19,
            mobile_pocket_length_by_width = $20
        WHERE id = $1
        "#,
        measurement_id,
        measurement.date,
        measurement.length_fl,
        measurement.length_bl,
        measurement.chest,
        measurement.waist,
        measurement.hips,
        measurement.shoulder,
        measurement.sleeve_length,
        measurement.neck,
        measurement.open_hand,
        measurement.chest_up,
        measurement.cuff_width,
        measurement.neck_width,
        measurement.aram_hole,
        measurement.fo_width,
        measurement.frant_pocket_length,
        measurement.farnt_pocket_length_by_width,
        measurement.side_pocket,
        measurement.mobile_pocket_length_by_width,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn update_invoice_header(
    tx: &mut sqlx::PgTransaction<'_>,
    invoice_id: Uuid,
    input: &CreateInvoiceInput,
    total_price: f64,
    gift_card_redeemed: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE invoices
        SET invoice_date = $2,
            branch_id = $3,
            discount = $4::float8,
            discount_unit = $5,
            payment_status = $6,
            amount_paid = $7::float8,
            advance_amount = $7::float8,
            advance_payment_type = $8,
            customer_id = $9,
            total_price = $10::float8,
            gift_card_redeemed = $11::float8
        WHERE id = $1
        "#,
        invoice_id,
        input.date,
        input.branch_id,
        input.discount,
        input.discount_unit.as_str(),
        input.payment_status.as_str(),
        input.amount_paid,
        input.payment_type.map(PaymentType::as_str),
        input.customer_id,
        total_price,
        gift_card_redeemed,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
