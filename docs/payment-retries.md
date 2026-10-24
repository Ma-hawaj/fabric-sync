# Recording payments safely

`POST /api/invoices/:id/payments` requires one UUID `requestId` per intended
payment:

```json
{
  "requestId": "019c960d-c3aa-4b48-ad0a-766572fc4075",
  "amount": 25,
  "paymentType": "cash",
  "orderId": null
}
```

The server stores the ID and a 32-byte SHA-256 hash in `invoice_payments`.
It computes the hash from the versioned operation, invoice ID and typed amount,
method and optional order ID. It does not store duplicate request JSON or accept
a client-supplied hash. Missing and explicit-null order IDs have the same meaning.

The invoice lock serializes payment attempts. Repeating the same ID and values
returns the original payment without inserting another row or advancing the
invoice revision. Reusing that ID with changed values returns 409, even if the
invoice could accept another payment. A failed transaction does not reserve the
ID, so corrected input can succeed if the original attempt rolled back.

Both a first write and a replay return `{ payment, summary }`. `payment` is the
original stored payment, including its ID, timestamp and rounded amount;
`summary` reflects the current persisted invoice balance while the lock is held.
A replay remains valid after full payment or a later order cancellation/return.
Original invoice totals stay unchanged.

The Record Payment dialog keeps one request ID and its opening balance throughout
its lifetime. It preserves failed input, refreshes invoice/order history after
success or failure, and permits an unchanged retry even if a lost response was
followed by a balance refresh. Changed retries conflict when the first attempt
committed. Fields and dismissal are disabled while submitting. After an uncertain
response, check the payment history before opening a new payment dialog: a new
dialog deliberately starts a new intended payment with a new ID.

The fresh-database baseline adds nullable `request_id` and `request_hash` columns
to `invoice_payments`, requires them to be present together, checks the 32-byte
hash length, and makes `(invoice_id, request_id)` unique. Standalone payment
requests require both server-side. Invoice creation, collection and imports keep
their existing transaction guards and may leave both columns null. No upgrade
migration is added; this baseline has no deployed database to upgrade.
