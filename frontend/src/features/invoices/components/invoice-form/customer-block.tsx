import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { CheckIcon, PlusIcon, RulerIcon, UserIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { PhoneField, TextField, TextareaField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import {
  measurementFromSnapshot,
  MeasurementFields,
} from '@/features/customers/components/measurement-fields'
import type { Customer } from '@/features/customers/types/customers'
import type { Material } from '../../types/materials'
import { createEmptyOrder } from '../../types/invoice-form'
import type {
  CustomerMode,
  InvoiceCustomerDraft,
  InvoiceFormApi,
} from '../../types/invoice-form'
import type { MeasurementDraft } from '@/features/customers/types/measurement-form'
import { OrderBlock } from './order-block'
import { useInvoiceWorkspace } from './invoice-workspace'
import {
  MEASUREMENT_FITS,
  MEASUREMENT_TYPES,
} from '@/features/customers/types/measurement-form'

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
  locationLabelForId?: (id: string) => string | null
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
  locationLabelForId,
  onRemove,
  removable,
}: CustomerBlockProps) {
  const base = `customers[${customerIndex}]`
  const workspace = useInvoiceWorkspace()
  const draft = useStore(
    form.store,
    (state): InvoiceCustomerDraft | undefined =>
      state.values.customers[customerIndex],
  )
  const [identityOpen, setIdentityOpen] = useState(
    !draft?.existingCustomerId && !draft?.name,
  )
  const isMeasurementReady = (measurement: MeasurementDraft) =>
    (MEASUREMENT_TYPES as readonly string[]).includes(measurement.type) &&
    (MEASUREMENT_FITS as readonly string[]).includes(measurement.fit)
  const [measurementsOpen, setMeasurementsOpen] = useState(
    !draft || !isMeasurementReady(draft.measurement),
  )
  const [measurementAttempted, setMeasurementAttempted] = useState(false)
  useEffect(() => {
    const target = workspace?.validationTarget
    if (target?.path.startsWith(`${base}.measurement`))
      setMeasurementsOpen(true)
    else if (
      target?.path.startsWith(`${base}.`) &&
      !target.path.startsWith(`${base}.orders`)
    )
      setIdentityOpen(true)
  }, [workspace?.validationTarget, base])
  // The full row behind the stored `existingCustomerId`. The whole-customer
  // list is no longer loaded, so measurements for the prefill, the info panel
  // and the history all resolve from the row the picker handed over — or, on
  // an edit form, the row the loaded invoice rebuilt for that id.
  const storedId = (
    form.state.values as unknown as {
      customers?: { existingCustomerId?: string }[]
    }
  ).customers?.[customerIndex]?.existingCustomerId
  const [picked, setPicked] = useState<Customer | null>(() =>
    storedId ? (initialCustomerForId?.(storedId) ?? null) : null,
  )

  const displayName =
    draft?.mode === 'new'
      ? draft.name
      : (picked?.name ??
        (draft?.existingCustomerId
          ? customerLabelForId?.(draft.existingCustomerId)
          : ''))
  const phone = draft?.mode === 'new' ? draft.mobileNo : picked?.mobileNo
  const ready = draft && isMeasurementReady(draft.measurement)
  const snapshot = picked?.measurements.find(
    (measurement) => measurement.id === draft?.measurement.loadedFromId,
  )

  return (
    <section
      className="space-y-5 rounded-xl border border-border/60 bg-card p-4 sm:p-5"
      aria-label={`Customer ${customerNumber}`}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {displayName || `Customer ${customerNumber}`}
          </h3>
          <p className="text-xs text-muted-foreground">
            {phone || 'Select a customer or add someone new'}
          </p>
          {picked?.address && draft?.mode === 'existing' && (
            <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
              {picked.address}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-expanded={identityOpen}
          aria-controls={`${base}.identity`}
          className="col-start-2 row-start-2 justify-self-start"
          onClick={() => setIdentityOpen(!identityOpen)}
        >
          {identityOpen ? 'Close customer details' : 'Change customer'}
        </Button>
        {removable && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            type="button"
            aria-label={`Remove customer ${customerNumber}`}
            className="col-start-3 row-start-1"
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-6">
        <div
          id={`${base}.identity`}
          hidden={!identityOpen}
          className="space-y-4"
        >
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
                  onChange={(label) => {
                    const mode = (
                      label === 'Existing Customer' ? 'existing' : 'new'
                    ) satisfies CustomerMode
                    if (mode === modeField.state.value) return
                    modeField.handleChange(mode)
                    if (mode === 'new') {
                      form.setFieldValue(
                        `${base}.existingCustomerId` as never,
                        '' as never,
                      )
                      form.setFieldValue(
                        `${base}.measurement` as never,
                        measurementFromSnapshot(null) as never,
                      )
                      setPicked(null)
                      setMeasurementsOpen(true)
                    }
                  }}
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
                            if (customer) setIdentityOpen(false)
                            setMeasurementsOpen(
                              !customer?.measurements[0] ||
                                !isMeasurementReady(
                                  measurementFromSnapshot(
                                    customer.measurements[0],
                                  ),
                                ),
                            )
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
                      defaultCountry="BH"
                    />

                    <TextareaField
                      form={form}
                      name={`${base}.address`}
                      label="Address (optional)"
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
            <div
              hidden={
                !draft ||
                (draft.mode === 'existing' && !draft.existingCustomerId)
              }
              className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3"
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:flex sm:flex-wrap">
                <RulerIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Measurements
                    {snapshot
                      ? ` · ${new Date(snapshot.date).toLocaleDateString()}`
                      : ' · New record'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ready
                      ? `Type: ${draft.measurement.type} · Fit: ${draft.measurement.fit}`
                      : 'Choose a measurement type and fit before saving.'}
                  </p>
                </div>
                {ready && (
                  <span className="col-start-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                    <CheckIcon className="size-3" />
                    Ready
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={measurementsOpen}
                  aria-controls={`${base}.measurements`}
                  className="col-start-2 justify-self-end"
                  onClick={() => setMeasurementsOpen(!measurementsOpen)}
                >
                  {measurementsOpen
                    ? 'Hide measurements'
                    : 'Review / Edit measurements'}
                </Button>
              </div>
              <div id={`${base}.measurements`} hidden={!measurementsOpen}>
                <MeasurementFields
                  form={form}
                  basePath={`${base}.measurement`}
                  history={selected?.measurements ?? []}
                />
                {measurementAttempted && !ready && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    Pick a measurement type and fit.
                  </p>
                )}
                <div className="mt-4 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMeasurementAttempted(true)
                      if (ready) setMeasurementsOpen(false)
                    }}
                  >
                    Done with measurements
                  </Button>
                </div>
              </div>
            </div>
          )}
        </form.Subscribe>
      </div>

      <form.Field name={`${base}.orders` as never} mode="array">
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
                locationLabelForId={locationLabelForId}
                removable={ordersField.state.value.length > 1}
                onRemove={() => ordersField.removeValue(orderIndex)}
                onDuplicate={() => {
                  const duplicate = {
                    ...order,
                    key: crypto.randomUUID(),
                    originalOrderId: undefined,
                    originalPricing: undefined,
                  }
                  ordersField.pushValue(duplicate)
                  workspace?.setActiveOrderKey(duplicate.key)
                }}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                const order = createEmptyOrder()
                ordersField.pushValue(order)
                workspace?.setActiveOrderKey(order.key)
              }}
              className="w-full border-dashed"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add Another Order
            </Button>
          </div>
        )}
      </form.Field>
    </section>
  )
}
