import { NumberField, TextField } from '@/components/form/fields'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
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
import { CURRENCY } from '@/lib/currency'
import {
  computeGiftCardLineTotal,
  computeOrderLineTotal,
  computeProductLineTotal,
  computeRedemptionTotal,
} from '../../lib/invoice-pricing'
import type {
  DiscountUnit,
  GiftCardRedemptionDraft,
  InvoiceCustomerDraft,
  InvoiceFormApi,
  InvoiceGiftCardDraft,
  InvoiceProductDraft,
  PaymentStatus,
} from '../../types/invoice-form'

const VAT_RATE = 0.15

function customerDisplayName(
  draft: InvoiceCustomerDraft,
  existingCustomers: Customer[],
) {
  if (draft.mode === 'existing') {
    return (
      existingCustomers.find((c) => c.id === draft.existingCustomerId)?.name ??
      'Select a customer'
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
  existingCustomers: Customer[],
): CustomerLineItems[] {
  return customers.map((customer) => ({
    key: customer.key,
    customerName: customerDisplayName(customer, existingCustomers),
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
  productNames: Record<string, string>,
): SummaryRow[] {
  return products.map((line, index) => ({
    key: line.key,
    label: productNames[line.productId] ?? `Product ${index + 1}`,
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
  existingCustomers: Customer[]
  branches: Location[]
  /** Product id to name, for labelling the product rows below. */
  productNames?: Record<string, string>
}

export function InvoiceSummary({
  form,
  existingCustomers,
  branches,
  productNames = {},
}: InvoiceSummaryProps) {
  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
      <h3 className="text-sm font-semibold">Invoice Summary</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="date" label="Date" />
        <form.Field name={'receivingBranch' as never}>
          {(field: any) => {
            const selected = branches.find((b) => b.id === field.state.value)
            return (
              <div className="space-y-1">
                <Label htmlFor={field.name}>Receiving Branch</Label>
                <Combobox
                  items={branches}
                  itemToStringLabel={(branch: Location) => branch.name}
                  isItemEqualToValue={(a: Location, b: Location) =>
                    a.id === b.id
                  }
                  value={selected ?? null}
                  onValueChange={(branch: Location | null) =>
                    field.handleChange(branch?.id ?? '')
                  }
                >
                  <ComboboxInput
                    id={field.name}
                    placeholder="Search branch..."
                    className="w-full"
                    showClear
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>No branches found.</ComboboxEmpty>
                    <ComboboxList>
                      {(branch: Location) => (
                        <ComboboxItem key={branch.id} value={branch}>
                          {branch.name}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
            )
          }}
        </form.Field>

        {/* A tailoring invoice finds its customer through the orders, so this
            only appears once there are no customer blocks left to do that. */}
        <form.Subscribe selector={(state: any) => state.values.customers}>
          {(customers: InvoiceCustomerDraft[]) =>
            customers.length === 0 && (
              <form.Field name={'customerId' as never}>
                {(field: any) => {
                  const selected =
                    existingCustomers.find((c) => c.id === field.state.value) ??
                    null
                  return (
                    <div className="space-y-1">
                      <Label htmlFor={field.name}>Customer (optional)</Label>
                      <Combobox
                        items={existingCustomers}
                        itemToStringLabel={(customer: Customer) =>
                          `${customer.name} — ${customer.mobileNo}`
                        }
                        isItemEqualToValue={(a: Customer, b: Customer) =>
                          a.id === b.id
                        }
                        value={selected}
                        onValueChange={(customer: Customer | null) =>
                          field.handleChange(customer?.id ?? '')
                        }
                      >
                        <ComboboxInput
                          id={field.name}
                          placeholder="Search customer..."
                          className="w-full"
                          showClear
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>No customers found.</ComboboxEmpty>
                          <ComboboxList>
                            {(customer: Customer) => (
                              <ComboboxItem key={customer.id} value={customer}>
                                {customer.name} — {customer.mobileNo}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>
                  )
                }}
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

          const lineItems = buildLineItems(customers, existingCustomers)
          const productRows = buildProductRows(products, productNames)
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
                <span className="text-muted-foreground">Subtotal</span>
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
                  state.values.amountPaid,
                  state.values.redemptions,
                ]}
              >
                {(subscribed: any) => {
                  const [discount, discountUnit, amountPaid, redemptions] =
                    subscribed as [
                      number | '',
                      DiscountUnit,
                      number | '',
                      GiftCardRedemptionDraft[],
                    ]
                  const discountValue = discount === '' ? 0 : discount
                  const discountAmount =
                    discountUnit === 'percent'
                      ? subtotal * (discountValue / 100)
                      : discountValue
                  const taxable = Math.max(subtotal - discountAmount, 0)
                  const vat = taxable * VAT_RATE
                  // Selling stored value is not a taxable supply — VAT is
                  // charged when the card is spent — so a card's face value
                  // joins the total after the tax is worked out. Keep this in
                  // step with VAT_RATE and compute_totals in the Rust service.
                  const total = taxable + vat + giftCardSales
                  // A card is tender, not a discount: it settles the invoice
                  // rather than reducing what the sale was worth, and can
                  // never pay out more than the total.
                  const redeemed = Math.min(
                    redemptions.reduce(
                      (sum, redemption) =>
                        sum + computeRedemptionTotal(redemption),
                      0,
                    ),
                    total,
                  )
                  const paid = amountPaid === '' ? 0 : amountPaid
                  const balanceDue = Math.max(total - redeemed - paid, 0)

                  return (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">VAT (15%)</span>
                        <span>
                          {CURRENCY} {vat.toFixed(2)}
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
                          {CURRENCY} {total.toFixed(2)}
                        </span>
                      </div>
                      {redeemed > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Gift Card Redeemed
                          </span>
                          <span>
                            −{CURRENCY} {redeemed.toFixed(2)}
                          </span>
                        </div>
                      )}

                      <div className="grid gap-4 sm:grid-cols-2 pt-2">
                        <form.Field name={'paymentStatus' as never}>
                          {(field: any) => (
                            <div className="space-y-1">
                              <Label htmlFor={field.name}>Payment Status</Label>
                              <Select
                                items={[
                                  { value: 'unpaid', label: 'Unpaid' },
                                  { value: 'partial', label: 'Partial' },
                                  { value: 'paid', label: 'Paid' },
                                ]}
                                value={field.state.value}
                                onValueChange={(value: PaymentStatus) =>
                                  field.handleChange(value)
                                }
                              >
                                <SelectTrigger
                                  id={field.name}
                                  className="w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unpaid">Unpaid</SelectItem>
                                  <SelectItem value="partial">
                                    Partial
                                  </SelectItem>
                                  <SelectItem value="paid">Paid</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </form.Field>
                        <NumberField
                          form={form}
                          name="amountPaid"
                          label="Amount Paid"
                        />
                      </div>

                      <div className="flex justify-between font-semibold pt-1">
                        <span>Balance Due</span>
                        <span>
                          {CURRENCY} {balanceDue.toFixed(2)}
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
