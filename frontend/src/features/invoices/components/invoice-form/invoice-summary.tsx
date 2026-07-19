import { NumberField, TextField } from '@/components/form/fields'
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
import { computeOrderLineTotal } from '../../lib/invoice-pricing'
import type { Branch } from '../../types/branches'
import type {
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
  branches: Branch[]
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
          {(field: any) => (
            <div className="space-y-1">
              <Label htmlFor={field.name}>Receiving Branch</Label>
              <Select
                items={branches.map((branch) => ({
                  value: branch.id,
                  label: branch.name,
                }))}
                value={field.state.value}
                onValueChange={(value: string) => field.handleChange(value)}
              >
                <SelectTrigger id={field.name} className="w-full">
                  <SelectValue placeholder="Select branch..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                      <span>SAR {order.total.toFixed(2)}</span>
                    </div>
                  )),
                )}
              </div>

              <Separator />

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>SAR {subtotal.toFixed(2)}</span>
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
                        <SelectItem value="SAR">SAR</SelectItem>
                        <SelectItem value="%">%</SelectItem>
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
                    'SAR' | '%',
                    number | '',
                  ]
                  const discountValue = discount === '' ? 0 : discount
                  const discountAmount =
                    discountUnit === '%'
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
                        <span>SAR {vat.toFixed(2)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>SAR {total.toFixed(2)}</span>
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
                        <span>SAR {balanceDue.toFixed(2)}</span>
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
