import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MeasurementFields } from '@/features/customers/components/measurement-fields'
import { useCustomer } from '@/features/customers/hooks/use-customer'
import type { Material } from '../../types/materials'
import { createEmptyOrder } from '../../types/invoice-form'
import type { InvoiceFormApi } from '../../types/invoice-form'
import { OrderBlock } from './order-block'

interface CustomerBlockProps {
  form: InvoiceFormApi
  customerIndex: number
  customerNumber: number
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
  customerLabelForId,
  initialMaterialForId,
  materialLabelForId,
  onRemove,
  removable,
}: CustomerBlockProps) {
  const base = `customers[${customerIndex}]`

  return (
    <div className="space-y-6 rounded-xl border border-border/60 bg-card p-5">
      <form.Subscribe
        selector={(state: any) => {
          const customer = state.values.customers[customerIndex]
          if (!customer || customer.mode !== 'existing') return null
          return (customer.existingCustomerId as string) || null
        }}
      >
        {(existingCustomerId: string | null) => (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Customer {customerNumber}
                {customerIndex > 0 && existingCustomerId
                  ? ` — ${customerLabelForId?.(existingCustomerId) ?? ''}`
                  : ''}
              </h3>
              {removable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  type="button"
                >
                  <XIcon className="h-3.5 w-3.5" />
                  Remove Customer
                </Button>
              )}
            </div>
            <CustomerMeasurements
              form={form}
              base={base}
              customerId={existingCustomerId}
            />
          </>
        )}
      </form.Subscribe>

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
              <PlusIcon />
              Add Another Order
            </Button>
          </div>
        )}
      </form.Field>
    </div>
  )
}

// The measurement history behind the picked customer, fetched by id — the
// invoice-level picker in the summary owns the selection, this only reads it
// back for the prefill baseline and the history dropdown.
function CustomerMeasurements({
  form,
  base,
  customerId,
}: {
  form: InvoiceFormApi
  base: string
  customerId: string | null
}) {
  const { data: customer } = useCustomer(customerId)

  return (
    <MeasurementFields
      form={form}
      basePath={`${base}.measurement`}
      history={customer?.measurements ?? []}
    />
  )
}
