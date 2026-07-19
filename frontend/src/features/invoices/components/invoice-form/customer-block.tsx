import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import {
  measurementFromSnapshot,
  MeasurementFields,
} from '@/features/customers/components/measurement-fields'
import type { Customer } from '@/features/customers/types/customers'
import { createEmptyOrder } from '../../types/invoice-form'
import type { CustomerMode, InvoiceFormApi } from '../../types/invoice-form'
import { OrderBlock } from './order-block'

function customerOptionLabel(customer: Customer) {
  return `${customer.name} — ${customer.mobileNo}`
}

interface CustomerBlockProps {
  form: InvoiceFormApi
  customerIndex: number
  customerNumber: number
  existingCustomers: Customer[]
  onRemove: () => void
  removable: boolean
}

export function CustomerBlock({
  form,
  customerIndex,
  customerNumber,
  existingCustomers,
  onRemove,
  removable,
}: CustomerBlockProps) {
  const base = `customers[${customerIndex}]`

  return (
    <div className="space-y-6 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Customer {customerNumber}</h3>
        {removable && (
          <Button variant="ghost" size="sm" onClick={onRemove} type="button">
            <XIcon className="h-3.5 w-3.5" />
            Remove Customer
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold">Customer</h4>

          <form.Field name={`${base}.mode` as never}>
            {(modeField: any) => (
              <>
                <SegmentedOptions
                  options={['Existing Customer', '+ New Customer']}
                  value={
                    modeField.state.value === 'existing'
                      ? 'Existing Customer'
                      : '+ New Customer'
                  }
                  onChange={(label) =>
                    modeField.handleChange(
                      (label === 'Existing Customer'
                        ? 'existing'
                        : 'new') satisfies CustomerMode,
                    )
                  }
                  columns={2}
                />

                {modeField.state.value === 'existing' ? (
                  <form.Field name={`${base}.existingCustomerId` as never}>
                    {(idField: any) => {
                      const selected = existingCustomers.find(
                        (c) => c.id === idField.state.value,
                      )
                      return (
                        <div className="space-y-3">
                          <Select
                            items={existingCustomers.map((customer) => ({
                              value: customer.id,
                              label: customerOptionLabel(customer),
                            }))}
                            value={idField.state.value}
                            onValueChange={(customerId: string) => {
                              idField.handleChange(customerId)
                              const customer = existingCustomers.find(
                                (c) => c.id === customerId,
                              )
                              form.setFieldValue(
                                `${base}.measurement` as never,
                                measurementFromSnapshot(
                                  customer?.measurements[0] ?? null,
                                ) as never,
                              )
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select customer..." />
                            </SelectTrigger>
                            <SelectContent>
                              {existingCustomers.map((customer) => (
                                <SelectItem
                                  key={customer.id}
                                  value={customer.id}
                                >
                                  {customerOptionLabel(customer)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FieldError errors={idField.state.meta.errors} />

                          {selected && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                              <p className="text-sm font-semibold">
                                {selected.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {selected.mobileNo}
                                {selected.nameArabic
                                  ? ` · ${selected.nameArabic}`
                                  : ''}
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    }}
                  </form.Field>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        form={form}
                        name={`${base}.name`}
                        label="Full Name"
                      />
                      <TextField
                        form={form}
                        name={`${base}.nameArabic`}
                        label="Name (Arabic)"
                      />
                    </div>

                    <TextField
                      form={form}
                      name={`${base}.mobileNo`}
                      label="Phone"
                    />

                    <p className="text-xs text-muted-foreground">
                      This customer will be created when the invoice is saved.
                    </p>
                  </div>
                )}
              </>
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state: any) => {
            const customer = state.values.customers[customerIndex]
            if (!customer || customer.mode !== 'existing') return []
            return (
              existingCustomers.find(
                (c) => c.id === customer.existingCustomerId,
              )?.measurements ?? []
            )
          }}
        >
          {(history: Customer['measurements']) => (
            <MeasurementFields
              form={form}
              basePath={`${base}.measurement`}
              history={history}
            />
          )}
        </form.Subscribe>
      </div>

      <form.Field name={`${base}.orders` as never}>
        {(ordersField: any) => (
          <div className="space-y-4">
            {ordersField.state.value.map((order: any, orderIndex: number) => (
              <OrderBlock
                key={order.key}
                form={form}
                customerIndex={customerIndex}
                orderIndex={orderIndex}
                orderNumber={orderIndex + 1}
                removable={ordersField.state.value.length > 1}
                onRemove={() => ordersField.removeValue(orderIndex)}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => ordersField.pushValue(createEmptyOrder())}
              className="w-full border-dashed"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add Another Order
            </Button>
          </div>
        )}
      </form.Field>
    </div>
  )
}
