# Bahrain gift cards

This flow implements single-purpose vouchers sold at face value, redeemable
only for supplies in Bahrain with the same VAT treatment. The business confirmed
that all covered supplies are subject to 10% VAT. It is not a multi-purpose
voucher implementation. The business confirmed there are no existing gift cards
to migrate.

Source: Bahrain NBR, [VAT Retail and Wholesale Guide](https://s3-me-south-1.amazonaws.com/nbrproduserdata-bh/media/Ndy2KqM4kCbe8uRsgV6DRIbmhMbZuEeS6Qpy8s80.pdf),
sections 13.1 and 18.5. VAT is due at issue of a single-purpose voucher;
redemption does not tax the same value again. A redemption with additional
consideration lists all goods and the voucher used, and taxes only the additional
consideration. A fully voucher-covered purchase requires no second tax invoice.

## Application behavior

- Sell paid cards through the invoice form. Card descriptions identify them as
  single-purpose vouchers and include their unique codes.
- Card face values include VAT. Selling a BHD 110 card records BHD 100 taxable
  amount and BHD 10 VAT while retaining the full BHD 110 balance for spending.
- Redeeming BHD 110 against a BHD 110 purchase records no new taxable amount or
  VAT and prints a gift-card redemption receipt with the goods and voucher code.
- Redeeming BHD 110 against a BHD 132 purchase records BHD 20 taxable amount and
  BHD 2 new VAT, with BHD 22 left to pay. Cash/card payments do not change VAT.
- Discounts affect merchandise only. Card values are neither discounted nor
  increased to add VAT. Mixed merchandise/card sales use the same calculation.
- Tax amounts are saved on the invoice; reprints use the saved figures. Edits
  keep the original VAT rate. Migration 0005 adds the reporting view without
  changing saved tax amounts.
- `invoice_voucher_accounting.sales_amount` and the **Sales excl. VAT** column
  exclude card funding, include merchandise bought using cards, and subtract
  return credits. **Transaction Total** includes card funding and is not a
  revenue measure. This operational sales measure is not a general ledger or a
  revenue-recognition schedule for unfinished tailoring work.

For the BHD 110 issue and BHD 110 redemption example, combined transaction
totals are BHD 220, merchandise sales are BHD 100, and total VAT is BHD 10.
External accounting should hold the net BHD 100 as a voucher liability at issue,
release it to revenue on fulfillment, and record the BHD 10 VAT at issue.

## Cards issued without an invoice

The **Issue Gift Card** page issues monetary credit without creating a sale or
an invoice. The server records the signed-in operator as `issued_by`; the list
displays their staff name. Clients cannot set or edit this field.

There are no card types or manual tax-status choices. The server determines
whether a card was taxed at issue from its gift-card sale invoice. The read-only
`taxedAtIssue` field lets the form preview that same calculation; client-supplied
tax flags and prepaid amounts are ignored when saving an invoice.

Uninvoiced credit settles the customer's balance while the goods/services retain
their VAT. For BHD 110 of uninvoiced credit applied to BHD 110 of goods, the
purchase records BHD 100 taxable amount, BHD 10 VAT, no prepaid VAT value, and
zero balance due. It prints a tax invoice. Issuing the credit creates no invoice.

Cards can be used together. Against BHD 132 of goods, a BHD 55 paid-card redemption
and BHD 55 uninvoiced-credit redemption record BHD 55 previously taxed value,
BHD 70 newly taxable amount, BHD 7 new VAT, and BHD 22 balance due. Both balances
are decremented atomically. Edits restore old tender and resolve the submitted
cards again, keeping the invoice's original VAT rate.

Migration 0007 derives previously taxed value and document kind from the saved
tax snapshot. Reprints do not infer tax from the current card record. Sales
reporting continues to include merchandise and exclude gift-card funding.
Expiry, voiding, available balance, duplicate-code and overpayment checks still
apply to every card.

This flow treats uninvoiced value as monetary credit, not as a discount coupon
or a deemed-supply relief claim. Those promotion rules are separate under NBR
sections 6 and 13.2. A newly issued uninvoiced card does not inherit another
card's prepaid VAT or transfer/disable its balance; a tax-linked replacement
workflow is outside this change.
