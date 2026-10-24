# Cancellations, returns and refunds

## Staff workflow

On an invoice, choose **Return & Refund**, select the merchandise, enter a reason, and confirm the refund in the same form. Retail products can optionally be restocked at any active location that holds stock. The location selector defaults to the original sale location when it remains eligible; otherwise staff choose a destination. The original location may be retired or unknown without preventing restocking elsewhere. Only the selected destination receives inventory. Return history shows the restock destination and original sale location. Collected tailoring garments are returned once as whole garments; their consumed fabric is preserved.

The credit uses the original discounted, VAT-inclusive selling value plus that order's original urgency fee. Urgency fees are added after discounts and stay with their own garment. Credit first reduces the invoice's unpaid balance. Any excess, including earlier pending customer credit, is refunded at confirmation. The form shows the split between external payment and original gift cards. Staff select Cash, Benefit or Card for the external portion and pay the customer before confirming; the application records that manual payout and does not call a payment provider. Gift card refunds restore the original cards atomically. **Refund later** is an explicit exception: the credit remains visible as refund due and can be paid through **Refund Pending Credit**.

On an order, the action depends on collection:

- **Cancel Order** closes an uncollected garment. Before production starts, it receives full credit. After a non-delivery production stage is done, or a repair has been recorded, staff enter the retained work/material charge and confirm it was agreed with the customer. The credit is the discounted order value less that charge. Cancellation and any refund use one confirmation.
- **Return Order** closes a collected garment and credits its full discounted selling value, using the same combined refund form. Rework without a financial return continues through the repair flow.

Cancellation never assumes fabric is reusable. Staff may restore only the quantity confirmed unused, up to the original quantity, to the recorded original deduction location. New shop-fabric orders record that location separately from the editable production location. Older orders without a recorded origin, inactive stock locations, and customer-provided fabric cannot be automatically restocked through cancellation; verified legacy stock corrections use Inventory.

An order's outcome (**Active**, **Cancelled**, **Returned**) is separate from its lifecycle (**Pending**, **Ready**, **Collected**) and payment. Both pending and ready garments can be cancelled. Closed orders retain collection timestamps, production records, assignments and repair history, but cannot receive production, assignment, repair, location, readiness or collection updates. Cancelled orders are excluded from pending collection counts and bulk collection. Closed orders are excluded from pickup readiness and cannot be marked ready or reopened. Cancelling a pending garment can make the remaining garments ready, advancing the invoice's readiness generation. A return retains the original collection date. The invoice and order show the outcome and financial history; printed orders show closure and reason.

Retail quantities can be returned in parts to two decimal places. Gift card **sales** cannot be returned through this flow. Gift card **tender** can only be restored to original redeemed cards. An invoice with any cancellation, return or refund cannot be rebuilt through editing.

The quantity number field shows purchased, already-returned and available quantities. Its buttons and typed values are bounded from zero to the unreturned purchased quantity. Zero or blank leaves a line out of the return. Garments must be whole items; retail quantities keep their existing two-decimal precision. The server rechecks eligibility and quantity under the invoice lock, including when another staff member has returned an item since the form opened.

## Balances and safeguards

`invoice_balances` is shared by invoices, orders, payments and refunds:

```text
net total = original total − cancellation/return credits
net tender = payments − cash/card/Benefit refunds
           + gift card redemptions − gift card refunds
balance due = max(net total − net tender, 0)
refund due  = max(net tender − net total, 0)
```

The original invoice total remains unchanged after a return, cancellation or refund. **Invoice Total**, including its list sorting and filtering, always uses the original sale value. Credits are recorded separately and shown alongside that total. Invoice details show the derived **After credits** amount, refunds, net tender and the remaining balance; payment and collection dialogs also show credits separately. The **Refunds** column shows total payouts (including gift card restorations) and any refund still due. **Net Paid** excludes external payouts; gift card tender is tracked separately. The **Payments & Refunds** history combines incoming payments and negative outgoing refunds for display; gift card refunds identify the original card.

**Returns & Cancellations** lists credit adjustments, reasons and affected merchandise. Each refund payout appears once in **Payments & Refunds**; linked credits provide a **View refund payments** link to that history. The combined return/refund confirmation remains one action. Staff attribution in credits, refunds, order closures and readiness resolves the stored subject through the shared user directory. The UI shows a name (or email when no name is available), and an explicit fallback when the directory or staff member is unavailable. Original subject and record IDs remain in the audit data without appearing as staff names or record labels. Display names reflect the current directory; no historical name snapshot is introduced.

Refunds remain positive amounts in the dedicated `invoice_refunds` audit ledger; no schema change or negative insert into `invoice_payments` is needed. A unified transaction table with an explicit payment/refund type is another valid design, but a negative amount alone would lose refund-specific validation and links. The shared balance view already subtracts refunds exactly once. For example, an invoice for 100, paid 100, credited 30 and refunded 30 still has an **Invoice Total of 100**, with **After credits of 70**, net tender of 70, and no balance or refund due. A credit reduces the amount owed; a refund reduces tender held. Neither rewrites the original invoice total.

Discounted merchandise credit is allocated across original lines in stable line-ID order using cumulative integer cents, then each garment's original urgency fee is added to that garment's credit limit. Fees are never discounted or redistributed to other garments or retail items. Partial returns preserve rounding remainders, so returning a three-unit line in three parts credits the same total as one full return. Retained charges cannot exceed the order's credit limit.

A refund is limited by refund due and remaining tender. External refunds cannot exceed external payments still held, and each gift card refund cannot exceed that card's original redemption less earlier refunds on this invoice. Restoring a card does not reactivate it or extend its expiry. An immediate refund must cover the exact refund due; partial payouts are supported when settling explicitly deferred credit.

Every operational order write and financial adjustment locks the parent invoice in the same order. The credit, closure, stock movements and all refund tenders commit in one database transaction. A failure rolls back the whole operation. Internally, append-only credit and payout records remain separate and linked by `adjustment_id`, preserving accurate unpaid returns, mixed tender and audit history. Records retain the required reason, authenticated user subject, timestamp and structured adjustment details. Retry checks retain a server-computed SHA-256 request hash rather than a duplicate JSON payload. There are no ledger edit or delete endpoints.

Credits and refunds also advance the invoice's notification revision. WhatsApp previews and queued notifications using older invoice figures become stale and require a fresh preview; no notification is sent automatically by a return or cancellation.

## API

All endpoints require bearer authentication; financial writes also require a user subject.

- `GET /api/invoices/:id/returns` — settlement, merchandise with remaining quantity, outcome and credit limits, adjustment/refund history, and original redeemed cards with remaining refund limits.
- `POST /api/invoices/:id/returns` — credit selected merchandise, optionally restock products, and apply the refund plan atomically.
- `GET /api/orders/:id/cancel` — production state, stock provenance and current invoice return/refund context.
- `POST /api/orders/:id/cancel` — close an uncollected order, credit its discounted value less any agreed retained charge, restore confirmed unused fabric if eligible, and apply the refund plan atomically.
- `POST /api/invoices/:id/refunds` — settle explicitly deferred customer credit with a payout or original gift card restoration.

Example combined return:

```json
{
  "requestId": "3d22cc6e-222c-4fc1-a185-dd859641ec49",
  "reason": "Wrong size",
  "lines": [
    {
      "lineId": "f753e482-3b82-4c83-9363-c26f23667f36",
      "quantity": 1,
      "restock": true,
      "restockLocationId": "b136a92c-330a-4fd3-b26b-2159fb1b1095"
    }
  ],
  "refund": {
    "timing": "now",
    "payments": [
      { "amount": 10.0, "paymentType": "benefit", "giftCardId": null }
    ]
  }
}
```

Example cancellation after production starts:

```json
{
  "requestId": "0924fe0f-680d-43dc-a3fa-cb3bdbdf5d93",
  "reason": "Customer changed plans; retained charge agreed",
  "retainedCharge": 25.0,
  "workChargeConfirmed": true,
  "restoredMaterialQuantity": 1.5,
  "unusedMaterialConfirmed": true,
  "refund": { "timing": "later" }
}
```

A refund plan is either `{ "timing": "now", "payments": [...] }` or `{ "timing": "later" }`. No payout is needed when credit only offsets debt: use `now` with an empty array. Omitting the plan defaults to that empty immediate plan, so a paid return cannot accidentally leave its payout pending. Each tender's `paymentType` is `cash`, `benefit`, `card` or `gift_card`; the last requires `giftCardId` from this invoice's redeemed cards and other methods require it to be null. A deferred payout uses `requestId`, `reason`, `amount`, `paymentType`, and `giftCardId` directly at `/refunds`.

Each returned retail line must include `restockLocationId` when `restock` is true; otherwise omit it or send null. Missing, inactive, non-stock or nonexistent destinations return 400, and garment returns cannot be restocked. The server locks and revalidates each selected location in the transaction. The audit row stores the destination while the original invoice line retains the sale location. Both location IDs and names are returned in history.

Adjustment writes return `{ "id": "..." }`. Standalone payment recording also protects retries with a request ID and server-computed hash; see [payment retry behavior](payment-retries.md). Reasons contain 1–1000 nonblank characters. Monetary amounts and quantities use at most two decimal places, matching existing storage.

Generate one UUID `requestId` per intended operation. The server hashes the operation version, target invoice or cancellation order, and typed input after defaults are applied. Object keys are sorted; array order and field values remain significant. The separately stored request ID is excluded from the hash. Only the 32-byte hash is retained for replay comparison; reasons, quantities, stock decisions and payouts remain in their structured audit records. Retrying unchanged values with the same ID returns the original result without another credit, stock movement, closure or payout. Reusing an ID with different values, including a different cancellation order or restock destination, returns 409. Return hashes use operation version `invoice.return.v2` to include the destination. Invalid eligibility, quantities or refund limits return 400. After an uncertain response, refresh the history and retry the original request. Each return, refund or cancellation dialog preserves one request ID for its entire lifetime, including edited retries. If the original attempt committed, an edited retry conflicts and directs staff to refresh the history. If the original attempt rolled back, corrected values can succeed with the same ID. Opening a new dialog starts a new intended operation.

Migrations run on backend startup. With no deployed database to upgrade, the return/refund/cancellation schema is included directly in the original fresh-database baseline: `0001_core_schema.sql` defines the tables and financial/outcome views, `0003_readiness_and_revisions.sql` defines closure-aware readiness and credit/refund revision triggers, and `0004_list_indexes.sql` defines the return-line indexes. There are no separate return or cancellation upgrade migrations. SQLx offline metadata in `backend/.sqlx` has been regenerated for the feature's new and changed queries. Consolidating the migrations preserves the resulting schema and requires no additional metadata changes. Once invoices exist, adjustments preserve their original totals, payments and sale lines. The invoice page and printable invoice show original figures together with credits, money paid back and any refund still due.
