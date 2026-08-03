use sqlx::types::Json;
use uuid::Uuid;

use crate::state::AppState;

use super::types::{
    CreateInvoiceInput, CreateOrderInput, CreateProductLineInput, InvoiceDetailLine,
    InvoiceLineKind, InvoiceListCustomer, InvoiceListItem, InvoiceParty, InvoiceRecord,
    InvoiceRedemptionLine, PaymentType, ReceivedInvoice,
};

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
        .map(|row| InvoiceDetailLine {
            kind: InvoiceLineKind::Order,
            order_id: Some(row.order_id),
            description: row.material_name,
            detail: order_specification(
                row.thobe_type,
                row.f_pocket,
                row.collar,
                row.sleeve,
                row.patti,
                row.more_details,
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

pub async fn list_invoices(state: &AppState) -> Result<Vec<InvoiceListItem>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT
            i.id,
            i.invoice_date,
            i.payment_status,
            i.total_price::float8 AS "total_price!",
            i.amount_paid::float8 AS "amount_paid!",
            i.advance_amount::float8 AS "advance_amount!",
            i.advance_payment_type,
            i.final_payment_type,
            i.gift_card_redeemed::float8 AS "gift_card_redeemed!",
            COALESCE(agg.item_count, 0) + COALESCE(items.item_count, 0) AS "item_count!",
            COALESCE(
                agg.customers,
                CASE
                    WHEN ic.id IS NOT NULL THEN json_build_array(jsonb_build_object(
                        'name', ic.name,
                        'mobileNo', ic.mobile_no
                    ))
                END,
                '[]'
            ) AS "customers!: Json<Vec<InvoiceListCustomer>>",
            COALESCE(agg.materials, '[]') AS "materials!: Json<Vec<String>>"
        FROM invoices i
        LEFT JOIN LATERAL (
            SELECT
                count(*) AS item_count,
                json_agg(DISTINCT jsonb_build_object(
                    'name', c.name,
                    'mobileNo', c.mobile_no
                )) AS customers,
                json_agg(DISTINCT mat.name) AS materials
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
        ORDER BY i.id DESC
        "#,
    )
    .fetch_all(state.db())
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| InvoiceListItem {
            id: row.id,
            date: row.invoice_date,
            customers: row.customers.0,
            item_count: row.item_count,
            materials: row.materials.0,
            total_price: row.total_price,
            payment_status: row.payment_status,
            amount_paid: row.amount_paid,
            advance_amount: row.advance_amount,
            advance_payment_type: row.advance_payment_type,
            final_payment_type: row.final_payment_type,
            gift_card_redeemed: row.gift_card_redeemed,
        })
        .collect())
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
            thobe_type, f_pocket, collar, sleeve, patti, more_details
        )
        VALUES ($1, $2, $3::float8, $4, $5::float8, $6, $7, $8, $9, $10, $11)
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
