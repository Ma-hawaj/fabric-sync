# Delivery pricing

Set `DELIVERY_CHARGE` in the backend environment to the fixed VAT-inclusive BHD fee, with at most two decimal places (for example, `DELIVERY_CHARGE=3.00`), and restart the API. The amount must be positive; leave it blank to disable new delivery selections until configured. `GET /pricing` exposes this setting as `deliveryCharge`.

Selecting Delivery adds the fee once per invoice, after merchandise discounts. It participates in the VAT breakdown and balance due. Pickup has no delivery fee. The backend calculates the fee and checks `expectedDeliveryCharge` so stale pricing cannot silently change the quoted total.

Invoices save the fee used at issue. Editing an invoice that remains Delivery preserves that saved fee, including zero for invoices predating this feature. Switching a pickup invoice to Delivery uses the current configured fee; switching to Pickup clears it. Invoice details and printed documents show the saved fee.

Apply migration `0005_delivery_charge.sql` before running the updated API. Do not edit older migrations.
