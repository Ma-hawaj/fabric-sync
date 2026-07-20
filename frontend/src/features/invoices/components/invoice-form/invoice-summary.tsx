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
import { computeOrderLineTotal } from '../../lib/invoice-pricing'
import type {
  DiscountUnit,
  InvoiceCustomerDraft,
  InvoiceFormApi,
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

interface InvoiceSummaryProps {
  form: InvoiceFormApi
  existingCustomers: Customer[]
  branches: Location[]
}

export function InvoiceSummary({
  form,
  existingCustomers,
  branches,
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
      </div>

      <Separator />

      <form.Subscribe selector={(state: any) => state.values.customers}>
        {(customers: InvoiceCustomerDraft[]) => {
          const lineItems = buildLineItems(customers, existingCustomers)
          const subtotal = lineItems.reduce(
            (sum, item) => sum + item.orders.reduce((s, o) => s + o.total, 0),
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
                ]}
              >
                {(subscribed: any) => {
                  const [discount, discountUnit, amountPaid] = subscribed as [
                    number | '',
                    DiscountUnit,
                    number | '',
                  ]
                  const discountValue = discount === '' ? 0 : discount
                  const discountAmount =
                    discountUnit === 'percent'
                      ? subtotal * (discountValue / 100)
                      : discountValue
                  const taxable = Math.max(subtotal - discountAmount, 0)
                  const vat = taxable * VAT_RATE
                  const total = taxable + vat
                  const paid = amountPaid === '' ? 0 : amountPaid
                  const balanceDue = Math.max(total - paid, 0)

                  return (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">VAT (15%)</span>
                        <span>
                          {CURRENCY} {vat.toFixed(2)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>
                          {CURRENCY} {total.toFixed(2)}
                        </span>
                      </div>

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
