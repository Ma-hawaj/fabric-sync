# Bahrain paid gift cards

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

## Complimentary and replacement cards

The separate **Issue Gift Card** page creates complimentary/replacement records,
not paid sales. These records have no sale invoice and cannot use the paid
single-purpose voucher redemption flow. Their VAT treatment must be established
separately before use. Paid cards sold through an invoice are immediately eligible
for normal redemption, subject to balance, expiry and active-status checks.
