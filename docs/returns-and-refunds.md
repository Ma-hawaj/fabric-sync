# Returns and refunds

Open an invoice and use **Returns & Refunds**:

1. Choose **Return Items**, enter the quantities and a reason, and optionally restock retail products at their original sale location.
2. The return credit reduces the unpaid balance first. Any excess becomes **Refund due**.
3. Pay the customer through Cash, Benefit or Card, then use **Record Refund** to record that payment. These methods record a manual payout; they do not call a payment provider. Choosing an original redeemed gift card restores its balance immediately.

Collected tailoring garments can be returned once as whole garments. Their consumed fabric is never restocked. Retail quantities can be returned in parts, to two decimal places. Gift card **sales** cannot be returned through this flow; gift card **tender** can be refunded to the original card. Rework continues to use the existing garment repair flow.

Returns use the original discounted, VAT-inclusive selling value. The backend allocates the stored taxable gross across the original merchandise lines in stable line-ID order, preserving every cent. Partial returns use cumulative quantity rounding, so returning a three-unit line in three parts credits exactly the same amount as returning it at once. The original invoice, payments, lines and collection timestamps remain intact. An invoice with a return or refund cannot be rebuilt through editing.

## Balances and safeguards

`invoice_balances` is the shared definition used by invoices, orders, payments and refunds:

```text
net total = original total − return credits
net tender = payments − cash/card/Benefit refunds
           + gift card redemptions − gift card refunds
balance due = max(net total − net tender, 0)
refund due  = max(net tender − net total, 0)
```

A refund is limited both by refund due and by the remaining tender in its channel. Gift card tender cannot be cashed out: external refunds cannot exceed external payments still held, and each gift card refund cannot exceed that card's original redemption less earlier refunds on this invoice. Restoring a card does not reactivate it or extend its expiry.

Every write holds the same invoice row lock used by payments, pickups and invoice edits. Returns, their stock movements, and gift card refunds commit atomically. Ledger records retain a required reason, timestamp, authenticated user subject and original request. There are no edit or delete endpoints for these records.

## API

All endpoints require the existing bearer authentication. Writes also require a user subject for the audit trail.

- `GET /api/invoices/:id/returns` — settlement, returnable merchandise with quantity and credit limits, return/refund history, and original redeemed gift cards with remaining refund limits.
- `POST /api/invoices/:id/returns` — credit selected merchandise and optionally restock products.
- `POST /api/invoices/:id/refunds` — record a payout or restore a redeemed gift card.

Example return:

```json
{
  "requestId": "3d22cc6e-222c-4fc1-a185-dd859641ec49",
  "reason": "Wrong size",
  "lines": [
    { "lineId": "f753e482-3b82-4c83-9363-c26f23667f36", "quantity": 1, "restock": true }
  ]
}
```

Example refund:

```json
{
  "requestId": "f0286eb0-0909-482f-997b-6905084341fa",
  "reason": "Returned merchandise",
  "amount": 10.00,
  "paymentType": "cash",
  "giftCardId": null
}
```

`paymentType` is `cash`, `benefit`, `card` or `gift_card`. The last requires `giftCardId` from this invoice's redeemed cards; other methods require it to be null. Both writes return `{ "id": "..." }`. Reasons contain 1–1000 nonblank characters; monetary amounts and quantities use at most two decimal places, matching existing storage.

Generate one UUID `requestId` for each intended operation. Retry an unchanged request using that same ID: it returns the original record without another credit, stock movement or payout. Reusing an ID with different values returns 409. Invalid quantities, methods or refund limits return 400. After an uncertain response, refresh the history and retry the original request. The frontend does this refresh and retains the ID for unchanged retries.

The new migration runs on backend startup. Apply it before serving the updated code; regenerated SQLx metadata is included. Existing invoices begin with zero returns and refunds. The invoice page and printable invoice show the original sale figures together with return credits, money paid back, and any refund still due.
