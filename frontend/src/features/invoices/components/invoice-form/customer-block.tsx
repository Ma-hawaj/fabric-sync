import * as React from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { PhoneField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import {
  measurementFromSnapshot,
  MeasurementFields,
} from '@/features/customers/components/measurement-fields'
import type { Customer } from '@/features/customers/types/customers'
import type { Material } from '../../types/materials'
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
  /** The picked row, so the summary can label this customer's line items. */
  onCustomerPicked: (customer: Customer | null) => void
  /** The row behind a stored id on an edit form, before anything is re-picked. */
  initialCustomerForId?: (id: string) => Customer | null
  /** The label for a stored id whose row isn't loaded yet (edit forms). */
  customerLabelForId?: (id: string) => string | null
  /** The material row behind a stored order id (edit forms). */
  initialMaterialForId?: (id: string) => Material | null
  /** The label for a stored material id (edit forms). */
  materialLabelForId?: (id: string) => string | null
  onRemove: () => void
  removable: boolean
}

export function CustomerBlock({
  form,
  customerIndex,
  customerNumber,
  onCustomerPicked,
  initialCustomerForId,
  customerLabelForId,
  initialMaterialForId,
  materialLabelForId,
  onRemove,
  removable,
}: CustomerBlockProps) {
  const base = `customers[${customerIndex}]`
  // The full row behind the stored `existingCustomerId`. The whole-customer
  // list is no longer loaded, so measurements for the prefill, the info panel
  // and the history all resolve from the row the picker handed over — or, on
  // an edit form, the row the loaded invoice rebuilt for that id.
  const storedId = (
    form.state.values as unknown as {
      customers?: { existingCustomerId?: string }[]
    }
  ).customers?.[customerIndex]?.existingCustomerId
  const [picked, setPicked] = React.useState<Customer | null>(() =>
    storedId ? (initialCustomerForId?.(storedId) ?? null) : null,
  )

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

      <div className="grid gap-6">
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
                    {(idField: any) => (
                      <div className="space-y-3">
                        <AsyncCombobox<Customer>
                          id={idField.name}
                          endpoint="/customers"
                          queryKey="invoice-customer"
                          searchField={['name', 'mobileNo']}
                          toOption={(customer) => ({
                            value: customer.id,
                            label: customerOptionLabel(customer),
                          })}
                          getValueLabel={customerLabelForId}
                          value={idField.state.value || null}
                          onValueChange={(id) => idField.handleChange(id ?? '')}
                          onSelectRow={(customer) => {
                            setPicked(customer)
                            onCustomerPicked(customer)
                            form.setFieldValue(
                              `${base}.measurement` as never,
                              measurementFromSnapshot(
                                customer?.measurements[0] ?? null,
                              ) as never,
                            )
                          }}
                          placeholder="Search customer by name or phone..."
                          emptyMessage="No customers found."
                        />
                        <FieldError errors={idField.state.meta.errors} />

                        {picked && (
                          <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                            <p className="text-sm font-semibold">
                              {picked.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {picked.mobileNo}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </form.Field>
                ) : (
                  <div className="space-y-4">
                    <TextField
                      form={form}
                      name={`${base}.name`}
                      label="Full Name"
                    />

                    <PhoneField
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
            if (!customer || customer.mode !== 'existing') return null
            return picked
          }}
        >
          {(selected) => (
            <MeasurementFields
              form={form}
              basePath={`${base}.measurement`}
              history={selected?.measurements ?? []}
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
                initialMaterialForId={initialMaterialForId}
                materialLabelForId={materialLabelForId}
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
