import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Customer } from '@/features/customers/types/customers'
import { createEmptyOrder } from '../../types/invoice-form'
import type {
  CustomerKind,
  CustomerMode,
  InvoiceFormApi,
} from '../../types/invoice-form'
import { TextField } from './form-fields'
import { GuardianField } from './guardian-field'
import {
  measurementFromSnapshot,
  MeasurementFields,
} from './measurement-fields'
import { OrderBlock } from './order-block'
import { SegmentedOptions } from './segmented-options'

function customerOptionLabel(customer: Customer, all: Customer[]) {
  if (customer.mobileNo) return `${customer.name} — ${customer.mobileNo}`
  const guardian = all.find((c) => c.id === customer.guardianId)
  return `${customer.name} (child — ${guardian?.name ?? 'unknown guardian'})`
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
                              label: customerOptionLabel(
                                customer,
                                existingCustomers,
                              ),
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
                                  {customerOptionLabel(
                                    customer,
                                    existingCustomers,
                                  )}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {selected && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                              <p className="text-sm font-semibold">
                                {selected.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {selected.mobileNo ?? 'No phone on file'}
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
                    <form.Field name={`${base}.customerType` as never}>
                      {(typeField: any) => (
                        <SegmentedOptions
                          options={['Adult', 'Child / Dependent']}
                          value={
                            typeField.state.value === 'adult'
                              ? 'Adult'
                              : 'Child / Dependent'
                          }
                          onChange={(label) =>
                            typeField.handleChange(
                              (label === 'Adult'
                                ? 'adult'
                                : 'child') satisfies CustomerKind,
                            )
                          }
                          columns={2}
                        />
                      )}
                    </form.Field>

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

                    <form.Field name={`${base}.customerType` as never}>
                      {(typeField: any) =>
                        typeField.state.value === 'adult' ? (
                          <TextField
                            form={form}
                            name={`${base}.mobileNo`}
                            label="Phone"
                          />
                        ) : (
                          <GuardianField
                            form={form}
                            customerIndex={customerIndex}
                            existingCustomers={existingCustomers}
                          />
                        )
                      }
                    </form.Field>

                    <form.Field name={`${base}.customerType` as never}>
                      {(typeField: any) => (
                        <p className="text-xs text-muted-foreground">
                          {typeField.state.value === 'adult'
                            ? 'This customer will be created when the invoice is saved.'
                            : 'This child will be created and linked to the selected guardian when the invoice is saved.'}
                        </p>
                      )}
                    </form.Field>
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
              customerIndex={customerIndex}
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
