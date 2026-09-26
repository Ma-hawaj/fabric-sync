import * as React from 'react'
import { NumberField, TextField } from '@/components/form/fields'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { Customer } from '@/features/customers/types/customers'
import type { Location } from '@/features/locations/types/location'
import { ORDER_RECEIVING_FILTERS } from '@/features/locations/lib/location-filters'
import type { Product } from '@/features/products/types/product'
import { CURRENCY } from '@/lib/currency'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  computeGiftCardLineTotal,
  computeInvoiceTotals,
  computeOrderLineTotal,
  computeProductLineTotal,
  computeRedemptionTotal,
  VAT_RATE,
} from '../../lib/invoice-pricing'
import type {
  DiscountUnit,
  GiftCardRedemptionDraft,
  InvoiceCustomerDraft,
  InvoiceFormApi,
  InvoiceGiftCardDraft,
  InvoiceProductDraft,
  PaymentDraft,
  PaymentType,
} from '../../types/invoice-form'
import { createEmptyPayment } from '../../types/invoice-form'

const PAYMENT_TYPE_OPTIONS: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

function customerDisplayName(
  draft: InvoiceCustomerDraft,
  customerNames: ReadonlyMap<string, Customer>,
) {
  if (draft.mode === 'existing') {
    return (
      customerNames.get(draft.existingCustomerId)?.name ?? 'Select a customer'
    )
  }
  return draft.name || 'New Customer'
}

interface CustomerLineItems {
  key: string
  customerName: string
  orders: { key: string; label: string; total: number }[]
}

function buildLineItems(
  customers: InvoiceCustomerDraft[],
  customerNames: ReadonlyMap<string, Customer>,
): CustomerLineItems[] {
  return customers.map((customer) => ({
    key: customer.key,
    customerName: customerDisplayName(customer, customerNames),
    orders: customer.orders.map((order, idx) => ({
      key: order.key,
      label: `Order ${idx + 1}`,
      total: computeOrderLineTotal(order),
    })),
  }))
}

interface SummaryRow {
  key: string
  label: string
  total: number
}

function buildProductRows(
  products: InvoiceProductDraft[],
  productNames: ReadonlyMap<string, Product>,
): SummaryRow[] {
  return products.map((line, index) => ({
    key: line.key,
    label: productNames.get(line.productId)?.name ?? `Product ${index + 1}`,
    total: computeProductLineTotal(line),
  }))
}

function buildGiftCardRows(giftCards: InvoiceGiftCardDraft[]): SummaryRow[] {
  return giftCards.map((line, index) => ({
    key: line.key,
    label: line.code ? `Gift card ${line.code}` : `Gift card ${index + 1}`,
    total: computeGiftCardLineTotal(line),
  }))
}

interface InvoiceSummaryProps {
  form: InvoiceFormApi
  /** Rows the pickers handed over, read at render time for the line labels. */
  customerNames: React.MutableRefObject<Map<string, Customer>>
  productNames: React.MutableRefObject<Map<string, Product>>
  /** Labels for stored ids whose rows aren't loaded yet (edit forms). */
  locationLabelForId?: (id: string) => string | null
  customerLabelForId?: (id: string) => string | null
}

export function InvoiceSummary({
  form,
  customerNames,
  productNames,
  locationLabelForId,
  customerLabelForId,
}: InvoiceSummaryProps) {
  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
      <h3 className="text-sm font-semibold">Invoice Summary</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="date" label="Date" />
        <form.Field name={'receivingBranch' as never}>
          {(field: any) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Receiving Branch</Label>
              <AsyncCombobox<Location>
                id={field.name}
                endpoint="/locations"
                queryKey="invoice-receiving-branch"
                searchField="name"
                filters={ORDER_RECEIVING_FILTERS}
                toOption={(location) => ({
                  value: location.id,
                  label: location.name,
                })}
                getValueLabel={locationLabelForId}
                value={field.state.value || null}
                onValueChange={(value) => field.handleChange(value ?? '')}
                placeholder="Search branch..."
                emptyMessage="No branches found."
              />
            </div>
          )}
        </form.Field>

        {/* A tailoring invoice finds its customer through the orders, so this
            only appears once there are no customer blocks left to do that. */}
        <form.Subscribe selector={(state: any) => state.values.customers}>
          {(customers: InvoiceCustomerDraft[]) =>
            customers.length === 0 && (
              <form.Field name={'customerId' as never}>
                {(field: any) => (
                  <div className="space-y-1">
                    <Label htmlFor={field.name}>Customer (optional)</Label>
                    <AsyncCombobox<Customer>
                      id={field.name}
                      endpoint="/customers"
                      queryKey="invoice-summary-customer"
                      searchField={['name', 'mobileNo']}
                      toOption={(customer) => ({
                        value: customer.id,
                        label: `${customer.name} — ${customer.mobileNo}`,
                      })}
                      getValueLabel={customerLabelForId}
                      value={field.state.value || null}
                      onValueChange={(id) => field.handleChange(id ?? '')}
                      placeholder="Search customer..."
                      emptyMessage="No customers found."
                    />
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>
      </div>

      <Separator />

      <form.Subscribe
        selector={(state: any) => [
          state.values.customers,
          state.values.products,
          state.values.giftCards,
        ]}
      >
        {(subscribedLines: any) => {
          const [customers, products, giftCards] = subscribedLines as [
            InvoiceCustomerDraft[],
            InvoiceProductDraft[],
            InvoiceGiftCardDraft[],
          ]

          const lineItems = buildLineItems(customers, customerNames.current)
          const productRows = buildProductRows(products, productNames.current)
          const giftCardRows = buildGiftCardRows(giftCards)

          // Orders and products are both goods, so they share one taxable
          // subtotal. Gift card sales are deliberately not in it.
          const subtotal =
            lineItems.reduce(
              (sum, item) => sum + item.orders.reduce((s, o) => s + o.total, 0),
              0,
            ) + productRows.reduce((sum, row) => sum + row.total, 0)

          const giftCardSales = giftCardRows.reduce(
            (sum, row) => sum + row.total,
            0,
          )

          return (
            <>
              <div className="space-y-1.5 text-sm">
                {lineItems.flatMap((item) =>
                  item.orders.map((order) => (
                    <div
                      key={order.key}
                      className="flex justify-between text-muted-foreground"
                    >
                      <span>
                        {item.customerName} — {order.label}
                      </span>
                      <span>
                        {CURRENCY} {order.total.toFixed(2)}
                      </span>
                    </div>
                  )),
                )}
                {productRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex justify-between text-muted-foreground"
                  >
                    <span>{row.label}</span>
                    <span>
                      {CURRENCY} {row.total.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Subtotal (incl. VAT)
                </span>
                <span>
                  {CURRENCY} {subtotal.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <NumberField form={form} name="discount" label="Discount" />
                <form.Field name={'discountUnit' as never}>
                  {(field: any) => (
                    <Select
                      value={field.state.value}
                      onValueChange={(value: string) =>
                        field.handleChange(value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="amount">{CURRENCY}</SelectItem>
                        <SelectItem value="percent">%</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </form.Field>
              </div>

              <form.Subscribe
                selector={(state: any) => [
                  state.values.discount,
                  state.values.discountUnit,
                  state.values.payments,
                  state.values.redemptions,
                ]}
              >
                {(subscribed: any) => {
                  const [discount, discountUnit, payments, redemptions] =
                    subscribed as [
                      number | '',
                      DiscountUnit,
                      PaymentDraft[],
                      GiftCardRedemptionDraft[],
                    ]
                  // Line prices are gross (VAT included): the discount comes
                  // off the gross and VAT is extracted from it — the shared
                  // computeInvoiceTotals keeps this in step with the backend's
                  // breakdown.
                  const totals = computeInvoiceTotals({
                    orderTotal: subtotal,
                    productTotal: 0,
                    giftCardSales,
                    discount: discount === '' ? 0 : discount,
                    discountUnit,
                    redeemed: redemptions.reduce(
                      (sum, redemption) =>
                        sum + computeRedemptionTotal(redemption),
                      0,
                    ),
                    paid: payments.reduce(
                      (sum, payment) =>
                        sum +
                        (payment.amount === ''
                          ? 0
                          : Math.max(payment.amount, 0)),
                      0,
                    ),
                  })

                  return (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          VAT ({Math.round(VAT_RATE * 100)}%, incl.)
                        </span>
                        <span>
                          {CURRENCY} {totals.vat.toFixed(2)}
                        </span>
                      </div>
                      {giftCardRows.map((row) => (
                        <div
                          key={row.key}
                          className="flex justify-between text-sm text-muted-foreground"
                        >
                          <span>{row.label} (not taxed)</span>
                          <span>
                            {CURRENCY} {row.total.toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>
                          {CURRENCY} {totals.total.toFixed(2)}
                        </span>
                      </div>
                      {totals.redeemed > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Gift Card Redeemed
                          </span>
                          <span>
                            −{CURRENCY} {totals.redeemed.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Payments taken up front with the invoice. Later ones
                          go through the receive endpoints or a till payment,
                          so this list is usually empty or a single advance. */}
                      <form.Field name={'payments' as never}>
                        {(paymentsField: any) => (
                          <div className="space-y-2 pt-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                Payments
                              </span>
                              {totals.paid > 0 && (
                                <span className="text-sm text-muted-foreground">
                                  {CURRENCY} {totals.paid.toFixed(2)} paid
                                </span>
                              )}
                            </div>
                            {paymentsField.state.value.map(
                              (payment: PaymentDraft, index: number) => (
                                <div
                                  key={payment.key}
                                  className="flex items-end gap-2"
                                >
                                  <div className="flex-1">
                                    <NumberField
                                      form={form}
                                      name={`payments[${index}].amount`}
                                      label={index === 0 ? 'Amount' : ''}
                                    />
                                  </div>
                                  <form.Field
                                    name={
                                      `payments[${index}].paymentType` as never
                                    }
                                  >
                                    {(methodField: any) => (
                                      <div className="w-36 space-y-1">
                                        {index === 0 && (
                                          <Label htmlFor={methodField.name}>
                                            Method
                                          </Label>
                                        )}
                                        <Select
                                          items={PAYMENT_TYPE_OPTIONS}
                                          value={methodField.state.value}
                                          onValueChange={(value: PaymentType) =>
                                            methodField.handleChange(value)
                                          }
                                        >
                                          <SelectTrigger
                                            id={methodField.name}
                                            className="w-full"
                                          >
                                            <SelectValue placeholder="Method..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {PAYMENT_TYPE_OPTIONS.map(
                                              (option) => (
                                                <SelectItem
                                                  key={option.value}
                                                  value={option.value}
                                                >
                                                  {option.label}
                                                </SelectItem>
                                              ),
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    )}
                                  </form.Field>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    type="button"
                                    onClick={() =>
                                      paymentsField.removeValue(index)
                                    }
                                    aria-label="Remove payment"
                                  >
                                    <XIcon className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ),
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() =>
                                paymentsField.pushValue(createEmptyPayment())
                              }
                              className="w-full border-dashed"
                            >
                              <PlusIcon className="h-3.5 w-3.5" />
                              Add Payment
                            </Button>
                          </div>
                        )}
                      </form.Field>

                      <div className="flex justify-between font-semibold pt-1">
                        <span>Balance Due</span>
                        <span>
                          {CURRENCY} {totals.balanceDue.toFixed(2)}
                        </span>
                      </div>
                    </>
                  )
                }}
              </form.Subscribe>
            </>
          )
        }}
      </form.Subscribe>
    </div>
  )
}
