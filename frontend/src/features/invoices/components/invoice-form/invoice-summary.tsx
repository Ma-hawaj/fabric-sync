import { useEffect, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { useStore } from '@tanstack/react-form'
import { PlusIcon, XIcon } from 'lucide-react'
import { DateField, NumberField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Customer } from '@/features/customers/types/customers'
import type { Location } from '@/features/locations/types/location'
import { ORDER_RECEIVING_FILTERS } from '@/features/locations/lib/location-filters'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import type { Material } from '../../types/materials'
import type { Product } from '@/features/products/types/product'
import { CURRENCY } from '@/lib/currency'
import {
  computeGiftCardLineTotal,
  computeInvoiceTotals,
  formatVatPercent,
  computeOrderLineTotal,
  computeOrderUrgentCharge,
  computeUrgentCharges,
  computeProductLineTotal,
  computeRedemptionTotal,
} from '../../lib/invoice-pricing'
import type {
  InvoiceFormApi,
  InvoiceFormValues,
  PaymentDraft,
  PaymentType,
} from '../../types/invoice-form'
import {
  createEmptyPayment,
  createEmptyRedemption,
} from '../../types/invoice-form'
import { RedemptionBlock } from './redemption-block'
import { focusInvoiceField, useInvoiceWorkspace } from './invoice-workspace'

const PAYMENT_TYPE_OPTIONS: { value: PaymentType; label: string }[] = [
  { value: 'benefit', label: 'Benefit' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
]

function invoiceTotals(values: InvoiceFormValues) {
  if (typeof values.expectedVatRate !== 'number') return null
  return computeInvoiceTotals({
    vatRate: values.expectedVatRate,
    orderTotal: values.customers.reduce(
      (sum, customer) =>
        sum +
        customer.orders.reduce(
          (total, order) => total + computeOrderLineTotal(order),
          0,
        ),
      0,
    ),
    productTotal: [...values.products, ...values.materials].reduce(
      (sum, line) => sum + computeProductLineTotal(line),
      0,
    ),
    giftCardSales: values.giftCards.reduce(
      (sum, line) => sum + computeGiftCardLineTotal(line),
      0,
    ),
    discount: values.discount === '' ? 0 : values.discount,
    discountUnit: values.discountUnit,
    urgentCharge: computeUrgentCharges(values.customers),
    redeemed: values.redemptions.reduce(
      (sum, line) => sum + computeRedemptionTotal(line),
      0,
    ),
    paid: values.payments.reduce(
      (sum, payment) =>
        sum + (payment.amount === '' ? 0 : Math.max(payment.amount, 0)),
      0,
    ),
  })
}

interface InvoiceSummaryProps {
  form: InvoiceFormApi
  customerNames: MutableRefObject<Map<string, Customer>>
  productNames: MutableRefObject<Map<string, Product>>
  materialNames?: MutableRefObject<Map<string, Material>>
  locationLabelForId?: (id: string) => string | null
  customerLabelForId?: (id: string) => string | null
  paymentsLocked?: boolean
  redemptionDate?: string
  children?: ReactNode
}

export function InvoiceSummary({
  form,
  customerNames,
  productNames,
  materialNames,
  locationLabelForId,
  customerLabelForId,
  paymentsLocked = false,
  redemptionDate = new Date().toISOString().slice(0, 10),
  children,
}: InvoiceSummaryProps) {
  const values = useStore(form.store, (state) => state.values)
  const totals = invoiceTotals(values)
  const subtotal = totals?.grossSubtotal
  const receivingDefault = useApplicableDefaultLocation('receiving')
  const workspace = useInvoiceWorkspace()
  const [discountOpen, setDiscountOpen] = useState(values.discount !== '')
  const [paymentsOpen, setPaymentsOpen] = useState(
    values.payments.some(
      (payment) => payment.amount !== '' || payment.paymentType !== '',
    ),
  )
  useEffect(() => {
    const path = workspace?.validationTarget?.path
    if (path?.startsWith('discount')) setDiscountOpen(true)
    if (path?.startsWith('payments')) setPaymentsOpen(true)
  }, [workspace?.validationTarget])
  const urgentCharge = computeUrgentCharges(values.customers)
  const hasUrgentOrders = values.customers.some((customer) =>
    customer.orders.some((order) => order.isUrgent),
  )
  const hasOrders = values.customers.some(
    (customer) => customer.orders.length > 0,
  )

  return (
    <div className="space-y-4">
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        aria-labelledby="invoice-summary-title"
      >
        <h2
          id="invoice-summary-title"
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Invoice Summary
        </h2>
        <div className="max-h-52 space-y-2 overflow-y-auto text-sm">
          {values.customers.flatMap((customer) =>
            customer.orders.map((order, index) => (
              <div
                key={order.key}
                className="flex justify-between gap-3 text-muted-foreground"
              >
                <span className="min-w-0 break-words">
                  {customer.mode === 'new'
                    ? customer.name || 'New Customer'
                    : (customerNames.current.get(customer.existingCustomerId)
                        ?.name ?? 'Select a customer')}{' '}
                  — Order {index + 1}
                </span>
                <span className="shrink-0 tabular-nums">
                  {order.price === ''
                    ? '—'
                    : `${CURRENCY} ${computeOrderLineTotal(order).toFixed(2)}`}
                  {computeOrderUrgentCharge(order) > 0 && (
                    <span className="block text-xs">
                      + {CURRENCY} {computeOrderUrgentCharge(order).toFixed(2)}{' '}
                      urgent charge
                    </span>
                  )}
                </span>
              </div>
            )),
          )}
          {values.products.map((line, index) => (
            <div
              key={line.key}
              className="flex justify-between gap-3 text-sm text-muted-foreground"
            >
              <span className="min-w-0 break-words">
                {productNames.current.get(line.productId)?.name ??
                  `Product ${index + 1}`}
              </span>
              <span className="shrink-0 tabular-nums">
                {CURRENCY} {computeProductLineTotal(line).toFixed(2)}
              </span>
            </div>
          ))}
          {values.materials.map((line, index) => (
            <div
              key={line.key}
              className="flex justify-between gap-3 text-sm text-muted-foreground"
            >
              <span className="min-w-0 break-words">
                {materialNames?.current.get(line.materialId)?.name ??
                  `Material ${index + 1}`}
              </span>
              <span className="shrink-0 tabular-nums">
                {CURRENCY} {computeProductLineTotal(line).toFixed(2)}
              </span>
            </div>
          ))}
          {!hasOrders &&
            !values.products.length &&
            !values.materials.length &&
            !values.giftCards.length && (
              <p className="text-muted-foreground">
                Add an order, material, product, or gift card to get started.
              </p>
            )}
        </div>
        <div className="flex justify-between gap-3 border-t pt-4 text-sm">
          <span className="text-muted-foreground">Subtotal (incl. VAT)</span>
          <span className="shrink-0 tabular-nums">
            {subtotal == null ? '—' : `${CURRENCY} ${subtotal.toFixed(2)}`}
          </span>
        </div>
        {discountOpen ? (
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-end gap-3">
            <NumberField form={form} name="discount" label="Discount" />
            <form.Field name={'discountUnit' as never}>
              {(field: any) => (
                <Select
                  value={field.state.value}
                  onValueChange={(value: string) => field.handleChange(value)}
                >
                  <SelectTrigger aria-label="Discount unit" className="w-full">
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
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ms-2"
            onClick={() => setDiscountOpen(true)}
          >
            <PlusIcon />
            Add discount
          </Button>
        )}
        {urgentCharge > 0 && (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Urgent charges (incl. VAT)
            </span>
            <span className="shrink-0 tabular-nums">
              {CURRENCY} {urgentCharge.toFixed(2)}
            </span>
          </div>
        )}
        {totals ? (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              VAT ({formatVatPercent(values.expectedVatRate as number)}%, incl.)
            </span>
            <span className="shrink-0 tabular-nums">
              {CURRENCY} {totals.vat.toFixed(2)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Loading VAT pricing...
          </p>
        )}
        {values.giftCards.map((line, index) => (
          <div
            key={line.key}
            className="flex justify-between gap-3 text-sm text-muted-foreground"
          >
            <span className="min-w-0 break-words">
              {line.code ? `Gift card ${line.code}` : `Gift card ${index + 1}`}{' '}
              (not taxed)
            </span>
            <span className="shrink-0 tabular-nums">
              {CURRENCY} {computeGiftCardLineTotal(line).toFixed(2)}
            </span>
          </div>
        ))}
        <div className="flex justify-between gap-3 rounded-lg border border-brand/20 bg-brand-soft p-3 font-semibold">
          <span>Total</span>
          <span className="shrink-0 tabular-nums">
            {totals ? `${CURRENCY} ${totals.total.toFixed(2)}` : '—'}
          </span>
        </div>
      </section>

      {
        <section
          className="space-y-4 rounded-xl border border-border bg-card p-4"
          aria-label="Collection"
        >
          <h3 className="text-sm font-semibold">Collection</h3>
          <form.Field name={'collectionMethod' as never}>
            {(field: any) => (
              <Field>
                <FieldLabel>Collection method</FieldLabel>
                <SegmentedOptions
                  id={field.name}
                  ariaLabel="Collection"
                  options={['Pickup', 'Delivery']}
                  value={
                    field.state.value === 'delivery' ? 'Delivery' : 'Pickup'
                  }
                  onChange={(value) => field.handleChange(value.toLowerCase())}
                  columns={2}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name={'receivingBranch' as never}>
            {(field: any) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Receiving Branch</FieldLabel>
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
                  getValueLabel={(id) =>
                    locationLabelForId?.(id) ??
                    (id === receivingDefault?.id ? receivingDefault.name : null)
                  }
                  value={field.state.value || null}
                  onValueChange={(value) => field.handleChange(value ?? '')}
                  placeholder="Search branch..."
                  emptyMessage="No branches found."
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <DateField
            form={form}
            name="targetDate"
            label={
              hasUrgentOrders
                ? 'Target Date (required)'
                : 'Target Date (optional)'
            }
            placeholder={
              hasUrgentOrders
                ? 'Pick a target date'
                : 'No collection date promised'
            }
          />
        </section>
      }

      {values.customers.length === 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <form.Field name={'customerId' as never}>
            {(field: any) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  Customer (optional)
                </FieldLabel>
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
              </Field>
            )}
          </form.Field>
        </section>
      )}

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        aria-label="Payment"
      >
        <h3 className="text-sm font-semibold">Payment</h3>
        {totals && totals.redeemed > 0 && (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Gift Card Redeemed</span>
            <span className="shrink-0 tabular-nums">
              −{CURRENCY} {totals.redeemed.toFixed(2)}
            </span>
          </div>
        )}
        <form.Field name={'payments' as never} mode="array">
          {(paymentsField: any) => (
            <div id="payments" className="space-y-3">
              {paymentsLocked ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Already taken — an edit never changes money. Take further
                    payments via Collect.
                  </p>
                  {paymentsField.state.value.map((payment: PaymentDraft) => (
                    <div
                      key={payment.key}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {PAYMENT_TYPE_OPTIONS.find(
                          (option) => option.value === payment.paymentType,
                        )?.label ?? '—'}
                      </span>
                      <span className="tabular-nums">
                        {CURRENCY}{' '}
                        {(payment.amount === '' ? 0 : payment.amount).toFixed(
                          2,
                        )}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {!paymentsOpen && (
                    <p className="text-xs text-muted-foreground">
                      No payment recorded. You can collect it later.
                    </p>
                  )}
                  <div hidden={!paymentsOpen} className="space-y-3">
                    {paymentsField.state.value.map(
                      (payment: PaymentDraft, index: number) => (
                        <div
                          key={payment.key}
                          className="space-y-2 rounded-lg border border-border/60 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              Payment {index + 1}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              type="button"
                              aria-label={`Remove payment ${index + 1}`}
                              onClick={() => paymentsField.removeValue(index)}
                            >
                              <XIcon />
                            </Button>
                          </div>
                          <NumberField
                            form={form}
                            name={`payments[${index}].amount`}
                            label={
                              index === 0 ? 'Amount' : `Amount ${index + 1}`
                            }
                          />
                          <form.Field
                            name={`payments[${index}].paymentType` as never}
                          >
                            {(field: any) => (
                              <Field
                                data-invalid={
                                  field.state.meta.errors.length > 0
                                }
                              >
                                <FieldLabel htmlFor={field.name}>
                                  {index === 0
                                    ? 'Method'
                                    : `Method ${index + 1}`}
                                </FieldLabel>
                                <Select
                                  items={PAYMENT_TYPE_OPTIONS}
                                  value={field.state.value}
                                  onValueChange={(value: PaymentType) =>
                                    field.handleChange(value)
                                  }
                                >
                                  <SelectTrigger
                                    id={field.name}
                                    className="w-full"
                                    aria-invalid={
                                      field.state.meta.errors.length > 0
                                    }
                                    aria-describedby={
                                      field.state.meta.errors.length > 0
                                        ? `${field.name}-error`
                                        : undefined
                                    }
                                    onBlur={field.handleBlur}
                                  >
                                    <SelectValue placeholder="Method..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PAYMENT_TYPE_OPTIONS.map((option) => (
                                      <SelectItem
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FieldError
                                  id={`${field.name}-error`}
                                  errors={field.state.meta.errors}
                                />
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      ),
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      if (paymentsOpen || !paymentsField.state.value.length)
                        paymentsField.pushValue(createEmptyPayment())
                      setPaymentsOpen(true)
                    }}
                  >
                    <PlusIcon />
                    {paymentsOpen ? 'Add Payment' : 'Record payment'}
                  </Button>
                </>
              )}
              <FieldError errors={paymentsField.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="redemptions" mode="array">
          {(redemptionsField: any) => (
            <div className="space-y-3">
              {redemptionsField.state.value.map(
                (line: { key: string }, index: number) => (
                  <RedemptionBlock
                    key={line.key}
                    form={form}
                    lineIndex={index}
                    date={redemptionDate}
                    onRemove={() => redemptionsField.removeValue(index)}
                  />
                ),
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ms-2"
                onClick={() =>
                  redemptionsField.pushValue(createEmptyRedemption())
                }
              >
                <PlusIcon />
                Redeem a Gift Card
              </Button>
            </div>
          )}
        </form.Field>
        <div className="flex justify-between gap-3 border-t pt-4 font-semibold">
          <span>Balance Due</span>
          <span className="shrink-0 tabular-nums">
            {totals ? `${CURRENCY} ${totals.balanceDue.toFixed(2)}` : '—'}
          </span>
        </div>
      </section>
      {children}
    </div>
  )
}

export function InvoiceMobileSummary({ form }: { form: InvoiceFormApi }) {
  const values = useStore(form.store, (state) => state.values)
  const totals = invoiceTotals(values)
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur-sm xl:hidden"
      aria-label="Invoice total"
    >
      <div>
        <p className="text-xs text-muted-foreground">Invoice total</p>
        <p className="font-semibold tabular-nums">
          {totals
            ? `${CURRENCY} ${totals.total.toFixed(2)}`
            : 'Loading VAT pricing...'}
        </p>
      </div>
      <Button
        type="button"
        onClick={() => {
          focusInvoiceField('invoice-summary-title')
        }}
      >
        Review invoice
      </Button>
    </div>
  )
}
