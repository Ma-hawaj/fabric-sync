import * as React from 'react'
import { useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { useQuery } from '@tanstack/react-query'
import { Switch } from '@base-ui/react/switch'
import { apiClient } from '@/lib/api'
import {
  calculateGarmentPrice,
  calculateUrgentCharge,
} from '../../lib/garment-pricing'
import { usePricing } from '../../hooks/use-pricing'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { PRODUCTION_FILTERS } from '@/features/locations/lib/location-filters'
import { CheckIcon, ChevronDownIcon, CopyIcon, XIcon } from 'lucide-react'
import { NumberField, TextField } from '@/components/form/fields'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY } from '@/lib/currency'
import { useDesignOptions } from '@/features/design-options/hooks/use-design-options'
import type { Location } from '@/features/locations/types/location'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { GrossVatHint } from './gross-vat-hint'
import { DesignPicker } from './design-picker'
import {
  focusInvoiceField,
  invoiceFieldPath,
  useInvoiceWorkspace,
} from './invoice-workspace'
import { orderDraftSchema } from '../../lib/invoice-schema'
import { cn } from '@/lib/utils'
import { materialTotalStock } from '../../types/materials'
import type { Material } from '../../types/materials'
import type {
  InvoiceFormApi,
  InvoiceOrderDraft,
} from '../../types/invoice-form'

function materialOptionLabel(material: Material) {
  return material.sku ? `${material.name} (${material.sku})` : material.name
}

interface StockLocationOption extends Location {
  quantity: number
  unit: string
}

function stockOptionLabel(option: StockLocationOption) {
  return `${option.name} (${option.quantity} ${option.unit})`
}

interface OrderBlockProps {
  form: InvoiceFormApi
  customerIndex: number
  orderIndex: number
  orderNumber: number
  /** The row behind a stored id on an edit form, before anything is re-picked. */
  initialMaterialForId?: (id: string) => Material | null
  /** The label for a stored id whose row isn't loaded yet (edit forms). */
  materialLabelForId?: (id: string) => string | null
  locationLabelForId?: (id: string) => string | null
  onRemove: () => void
  removable: boolean
  onDuplicate?: () => void
}

export function OrderBlock({
  form,
  customerIndex,
  orderIndex,
  orderNumber,
  initialMaterialForId,
  materialLabelForId,
  locationLabelForId,
  onRemove,
  removable,
  onDuplicate,
}: OrderBlockProps) {
  const base = `customers[${customerIndex}].orders[${orderIndex}]`
  const workspace = useInvoiceWorkspace()
  const [localExpanded, setLocalExpanded] = useState(true)
  const [showErrors, setShowErrors] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const materialSource = useStore(
    form.store,
    (state) =>
      state.values.customers[customerIndex]?.orders[orderIndex]
        ?.materialSource ?? 'shop',
  )
  // The row behind the stored `materialId`, remembered from the picker. The
  // "made at" options come from the material's own stock rows, which the list
  // endpoint returns nested — so the whole materials list is not needed. On an
  // edit form it starts seeded from the loaded invoice, with live stock at the
  // stored location, so the current "Made At" resolves without re-picking.
  const storedMaterialId = (
    form.state.values as unknown as {
      customers?: { orders?: { materialId?: string }[] }[]
    }
  ).customers?.[customerIndex]?.orders?.[orderIndex]?.materialId
  const [pickedMaterial, setPickedMaterial] = useState<Material | null>(() =>
    storedMaterialId
      ? (initialMaterialForId?.(storedMaterialId) ?? null)
      : null,
  )
  // Shop fabric needs stock at the default location. Customer fabric can use
  // the active production default directly. Never overwrite a chosen location.
  const stockDefault = useApplicableDefaultLocation('stock')
  // The whole design catalog, shared across every order block on the form —
  // one cached request for all seven pickers, however many orders there are.
  const {
    data: designOptions = [],
    isLoading: designLoading,
    isError: designError,
  } = useDesignOptions()
  const draft = useStore(
    form.store,
    (state): InvoiceOrderDraft | undefined =>
      state.values.customers[customerIndex]?.orders[orderIndex],
  )
  const selectedId = draft?.materialId ?? ''
  const pickedMatches = pickedMaterial?.id === selectedId
  const hasPickedPrices =
    pickedMatches &&
    pickedMaterial.juniorPrice != null &&
    pickedMaterial.normalPrice != null &&
    pickedMaterial.largePrice != null
  // Edit-form seeds contain stock and labels but not current catalog prices.
  const { data: currentMaterial, isError: materialError } = useQuery({
    queryKey: ['materials', 'pricing', selectedId],
    queryFn: async () =>
      (await apiClient.get<Material>(`/materials/${selectedId}`)).data,
    enabled: materialSource === 'shop' && !!selectedId && !hasPickedPrices,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const pricingMaterial = hasPickedPrices
    ? pickedMaterial
    : (currentMaterial ?? null)
  const resolvedMaterial = pickedMatches
    ? pickedMaterial
    : (currentMaterial ?? null)
  React.useEffect(() => {
    if (!stockDefault || (materialSource === 'shop' && !resolvedMaterial)) {
      return
    }
    const stocked =
      materialSource === 'customer' ||
      resolvedMaterial?.locations.some(
        (stock) => stock.locationId === stockDefault.id && stock.quantity > 0,
      )
    if (
      stocked &&
      form.state.values.customers[customerIndex]?.orders[orderIndex]
        ?.productionLocationId === ''
    ) {
      form.setFieldValue(
        `${base}.productionLocationId` as never,
        stockDefault.id as never,
      )
    }
  }, [
    stockDefault,
    resolvedMaterial,
    form,
    base,
    materialSource,
    customerIndex,
    orderIndex,
  ])
  const { data: pricingRules } = usePricing()
  const pricing =
    draft &&
    !designLoading &&
    !designError &&
    !(materialError && !hasPickedPrices)
      ? calculateGarmentPrice(
          draft,
          pricingMaterial,
          designOptions,
          pricingRules?.customerMaterialBasePrice ?? null,
        )
      : null
  const computedPrice = pricing?.total ?? ''
  const computedUrgentCharge = draft?.isUrgent
    ? calculateUrgentCharge(computedPrice, pricingRules?.urgentCharge)
    : 0
  React.useEffect(() => {
    if (draft && draft.urgentCharge !== computedUrgentCharge) {
      form.setFieldValue(
        `${base}.urgentCharge` as never,
        computedUrgentCharge as never,
      )
      if (form.state.submissionAttempts > 0) void form.validate('submit')
    }
  }, [form, base, draft, computedUrgentCharge])
  React.useEffect(() => {
    if (draft && draft.price !== computedPrice) {
      form.setFieldValue(`${base}.price` as never, computedPrice as never)
    }
  }, [form, base, draft, computedPrice])

  const expanded = workspace
    ? workspace.activeOrderKey === draft?.key
    : localExpanded
  const setExpanded = (next: boolean) => {
    if (workspace)
      workspace.setActiveOrderKey(next ? (draft?.key ?? null) : null)
    else setLocalExpanded(next)
  }
  const validation = orderDraftSchema.safeParse(draft)
  const thobe = designOptions.find(
    (option) =>
      option.category === 'thob_type' && option.slug === draft?.thobeType,
  )
  const fabric =
    materialSource === 'customer'
      ? draft?.customerMaterialDescription || 'Customer fabric'
      : (resolvedMaterial?.name ??
        (draft?.materialId ? materialLabelForId?.(draft.materialId) : null))
  const finishEditing = () => {
    if (!validation.success) {
      setShowErrors(true)
      focusInvoiceField(
        `${base}.${invoiceFieldPath(validation.error.issues[0].path)}`,
      )
      return
    }
    setShowErrors(false)
    setExpanded(false)
  }

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors',
        expanded ? 'border-primary/50' : 'border-border/60',
      )}
      aria-label={`Order ${orderNumber}`}
    >
      <div className="flex flex-wrap items-center gap-2 p-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 basis-full items-center gap-3 text-start sm:basis-56"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`${base}.editor`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
            {String(orderNumber).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {thobe?.label ?? `Order ${orderNumber}`}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {fabric || 'Choose fabric and production location'}
              {draft?.materialAmount !== ''
                ? ` · ${draft?.materialAmount} m`
                : ''}
            </span>
          </span>
          <span
            className={cn(
              'hidden items-center gap-1 rounded-md px-2 py-1 text-xs sm:inline-flex',
              validation.success
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {validation.success && <CheckIcon className="size-3" />}
            {expanded
              ? 'Editing'
              : validation.success
                ? 'Ready'
                : 'Needs details'}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {pricing && computedUrgentCharge !== ''
              ? `${CURRENCY} ${(pricing.total + computedUrgentCharge).toFixed(2)}`
              : '—'}
          </span>
          <ChevronDownIcon
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
        <div className="me-auto shrink-0 sm:me-0">
          <form.Field name={`${base}.isUrgent` as never}>
            {(field: any) => (
              <Field orientation="horizontal">
                <Switch.Root
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked)
                    if (form.state.submissionAttempts > 0)
                      void form.validate('submit')
                  }}
                  onBlur={field.handleBlur}
                  className="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary"
                >
                  <Switch.Thumb className="ms-0.5 block size-4 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4 rtl:data-checked:-translate-x-4" />
                </Switch.Root>
                <FieldLabel htmlFor={field.name}>
                  Urgent <span className="sr-only">order {orderNumber}</span>
                </FieldLabel>
              </Field>
            )}
          </form.Field>
        </div>
        {onDuplicate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Duplicate order ${orderNumber}`}
            onClick={onDuplicate}
          >
            <CopyIcon className="size-4" />
          </Button>
        )}
        {removable && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            type="button"
            aria-label={`Remove order ${orderNumber}`}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
      <div id={`${base}.editor`} hidden={!expanded}>
        <div className="space-y-5 border-t border-border/50 p-4">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Fabric &amp; production</h4>
            <form.Field name={`${base}.materialSource` as never}>
              {(field: any) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>
                    Material supplied by
                  </FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={['Shop', 'Customer']}
                    value={
                      field.state.value === 'customer' ? 'Customer' : 'Shop'
                    }
                    onChange={(label) => {
                      const source = label === 'Customer' ? 'customer' : 'shop'
                      if (source === field.state.value) return
                      field.handleChange(source)
                      form.setFieldValue(
                        `${base}.materialId` as never,
                        '' as never,
                      )
                      form.setFieldValue(
                        `${base}.customerMaterialDescription` as never,
                        '' as never,
                      )
                      form.setFieldValue(
                        `${base}.productionLocationId` as never,
                        '' as never,
                      )
                      setPickedMaterial(null)
                    }}
                  />
                </Field>
              )}
            </form.Field>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {materialSource === 'customer' ? (
                <div className="lg:col-span-2">
                  <TextField
                    form={form}
                    name={`${base}.customerMaterialDescription`}
                    label="Customer fabric description"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Customer-provided material does not use shop stock.
                  </p>
                </div>
              ) : (
                <form.Field name={`${base}.materialId` as never}>
                  {(field: any) => (
                    <Field
                      className="lg:col-span-2"
                      data-invalid={field.state.meta.errors.length > 0}
                    >
                      <FieldLabel htmlFor={field.name}>Material</FieldLabel>
                      <AsyncCombobox<Material>
                        id={field.name}
                        endpoint="/materials"
                        queryKey="invoice-order-material"
                        searchField={['name', 'sku']}
                        toOption={(material) => ({
                          value: material.id,
                          label: materialOptionLabel(material),
                        })}
                        getValueLabel={(id) =>
                          resolvedMaterial?.id === id
                            ? materialOptionLabel(resolvedMaterial)
                            : (materialLabelForId?.(id) ?? null)
                        }
                        value={field.state.value || null}
                        onValueChange={(value) => {
                          field.handleChange(value ?? '')
                          // "Made At" only lists this material's stock locations —
                          // drop a previously chosen one that may not stock it.
                          form.setFieldValue(
                            `${base}.productionLocationId` as never,
                            '' as never,
                          )
                        }}
                        onSelectRow={setPickedMaterial}
                        placeholder="Search material by name or SKU..."
                        emptyMessage="No materials found."
                      />
                      <FieldError errors={field.state.meta.errors} />
                      {resolvedMaterial && (
                        <p className="text-xs text-muted-foreground">
                          Available: {materialTotalStock(resolvedMaterial)}{' '}
                          {resolvedMaterial.unit}
                          {resolvedMaterial.locations.length > 0 &&
                            ` — ${resolvedMaterial.locations
                              .map(
                                (stock) =>
                                  `${stock.location}: ${stock.quantity}`,
                              )
                              .join(', ')}`}
                        </p>
                      )}
                    </Field>
                  )}
                </form.Field>
              )}

              {/* A material can only be made at a location where it is in
              stock — so this picker lists the selected material's stock
              locations rather than every stock-holding branch. */}
              <form.Field name={`${base}.productionLocationId` as never}>
                {(field: any) => {
                  if (materialSource === 'customer') {
                    return (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={field.name}>Made At</FieldLabel>
                        <AsyncCombobox<Location>
                          id={field.name}
                          endpoint="/locations"
                          queryKey="invoice-customer-material-production"
                          searchField="name"
                          filters={PRODUCTION_FILTERS}
                          toOption={(location) => ({
                            value: location.id,
                            label: location.name,
                          })}
                          getValueLabel={(id) =>
                            locationLabelForId?.(id) ??
                            (id === stockDefault?.id ? stockDefault.name : null)
                          }
                          value={field.state.value || null}
                          onValueChange={(value) =>
                            field.handleChange(value ?? '')
                          }
                          placeholder="Search production location..."
                          emptyMessage="No active production locations found."
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )
                  }
                  const stockOptions: StockLocationOption[] =
                    resolvedMaterial?.locations
                      .filter((stock) => stock.quantity > 0)
                      .map((stock) => ({
                        id: stock.locationId,
                        name: stock.location,
                        receivesOrders: false,
                        holdsStock: true,
                        isActive: true,
                        quantity: stock.quantity,
                        unit: resolvedMaterial.unit,
                      })) ?? []
                  const selected = stockOptions.find(
                    (location) => location.id === field.state.value,
                  )
                  return (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={field.name}>Made At</FieldLabel>
                      <Combobox
                        items={stockOptions}
                        itemToStringLabel={stockOptionLabel}
                        isItemEqualToValue={(a: Location, b: Location) =>
                          a.id === b.id
                        }
                        value={selected ?? null}
                        onValueChange={(location: Location | null) => {
                          field.handleChange(location?.id ?? '')
                        }}
                      >
                        <ComboboxInput
                          id={field.name}
                          placeholder="Search location..."
                          className="w-full"
                          showClear
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>
                            {resolvedMaterial
                              ? 'This material has no stock available.'
                              : 'Pick a material first.'}
                          </ComboboxEmpty>
                          <ComboboxList>
                            {(location: StockLocationOption) => (
                              <ComboboxItem key={location.id} value={location}>
                                {stockOptionLabel(location)}
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )
                }}
              </form.Field>

              <NumberField
                form={form}
                name={`${base}.materialAmount`}
                label="Quantity (m)"
              />

              <div className="space-y-2">
                <form.Field name={`${base}.price` as never}>
                  {(field: any) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel>Price incl. VAT ({CURRENCY})</FieldLabel>
                      <output
                        id={field.name}
                        tabIndex={-1}
                        aria-label={`Price incl. VAT (${CURRENCY})`}
                        className="text-sm font-semibold"
                      >
                        {pricing
                          ? `${CURRENCY} ${pricing.total.toFixed(2)}`
                          : '—'}
                      </output>
                      {pricing ? (
                        <p className="text-xs text-muted-foreground">
                          {pricing.tier
                            ? `${pricing.tier[0].toUpperCase()}${pricing.tier.slice(1)}`
                            : 'Fixed tailoring base'}
                          : {pricing.base.toFixed(2)} + designs:{' '}
                          {pricing.designCost.toFixed(2)}
                        </p>
                      ) : (
                        <p
                          role={
                            designError || materialError ? 'alert' : undefined
                          }
                          className="text-xs text-muted-foreground"
                        >
                          {designError || materialError
                            ? 'Could not load pricing. Reload to try again.'
                            : materialSource === 'customer' &&
                                pricingRules?.customerMaterialBasePrice == null
                              ? 'Customer-material pricing is unavailable. Contact an administrator.'
                              : 'Choose a priced material, quantity and valid designs.'}
                        </p>
                      )}
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
                <GrossVatHint gross={computedPrice} />
              </div>
              {draft?.isUrgent && (
                <div className="space-y-1.5">
                  <Label>Urgent charge incl. VAT ({CURRENCY})</Label>
                  <output
                    id={`${base}.urgentCharge`}
                    tabIndex={-1}
                    aria-label={`Urgent charge incl. VAT (${CURRENCY})`}
                    className="block text-sm font-semibold"
                  >
                    {draft.urgentCharge === ''
                      ? '—'
                      : `${CURRENCY} ${draft.urgentCharge.toFixed(2)}`}
                  </output>
                  <p className="text-xs text-muted-foreground">
                    {computedUrgentCharge === ''
                      ? 'Urgent pricing is unavailable. Contact an administrator.'
                      : 'Applied automatically for this order.'}
                  </p>
                  <form.Field name={`${base}.urgentCharge` as never}>
                    {(field: any) => (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </form.Field>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Design details</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ['thobeType', 'thob_type', 'Thob Type'],
                ['collar', 'neck', 'Collar'],
                ['sleeve', 'sleeve', 'Sleeve'],
                ['fPocket', 'front_pocket', 'Front Pocket'],
                ['sPocket', 'side_pocket', 'Side Pocket'],
                ['patti', 'patti', 'Patti (Front Strip)'],
                ['emd', 'emd', 'EMD'],
              ].map(([field, category, label]) => (
                <DesignPicker
                  key={field}
                  form={form}
                  name={`${base}.${field}`}
                  category={category}
                  label={label}
                  options={designOptions}
                />
              ))}
            </div>
            {designLoading && (
              <p className="text-xs text-muted-foreground">
                Loading design options...
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showNotes || !!draft?.moreDetails}
              onClick={() => setShowNotes(!showNotes)}
            >
              Add a note
            </Button>
            <div hidden={!showNotes && !draft?.moreDetails}>
              <form.Field name={`${base}.moreDetails` as never}>
                {(field: any) => (
                  <div className="space-y-1.5">
                    <Label htmlFor={field.name}>More Details</Label>
                    <Textarea
                      id={field.name}
                      placeholder="e.g. double stitching on hem, rush order for Eid..."
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </div>
                )}
              </form.Field>
            </div>
          </div>
          {showErrors && !validation.success && (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              {validation.error.issues.map((issue, index) => (
                <p key={index}>{issue.message}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={finishEditing}>
              Done editing
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
