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
import { XIcon } from 'lucide-react'
import { NumberField, TextField } from '@/components/form/fields'
import { DesignOptionGrid } from '@/features/design-options/components/design-option-grid'
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
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY } from '@/lib/currency'
import {
  selectCategoryOptions,
  useDesignOptions,
  designOptionImageSrc,
} from '@/features/design-options/hooks/use-design-options'
import type { DesignOption } from '@/features/design-options/types/design-option'
import type { Location } from '@/features/locations/types/location'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { GrossVatHint } from './gross-vat-hint'
import { materialTotalStock } from '../../types/materials'
import type { Material } from '../../types/materials'
import type {
  InvoiceFormApi,
  InvoiceOrderDraft,
} from '../../types/invoice-form'

function materialOptionLabel(material: Material) {
  return material.sku ? `${material.name} (${material.sku})` : material.name
}

// A stored value that matches no catalog option (legacy free text like
// "Saudi") can't be shown selected, but it still prints as text on the
// documents — so it stays put with a note rather than being wiped.
function UnknownDesignValue({
  value,
  onClear,
}: {
  value: string
  onClear: () => void
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Saved value &ldquo;{value}&rdquo; is not in the catalog.{' '}
      <button
        type="button"
        className="underline hover:text-foreground"
        onClick={onClear}
      >
        Clear it
      </button>{' '}
      or select a catalog option to calculate pricing. Saved invoices still
      print this value as text.
    </p>
  )
}

function CatalogGrid({
  form,
  name,
  category,
  options,
  columns = 3,
}: {
  form: InvoiceFormApi
  name: string
  category: string
  options: DesignOption[]
  columns?: number
}) {
  // EMD is optional. Keep an actual grid choice for clearing a stored value;
  // an empty form value cannot be selected by a button-less grid.
  const clearOption =
    category === 'emd' ? [{ id: '', label: 'None', image: null }] : []
  const items = [
    ...clearOption,
    ...selectCategoryOptions(options, category).map((option) => ({
      id: option.slug,
      label:
        option.cost > 0
          ? `${option.label} (+${CURRENCY} ${option.cost.toFixed(2)})`
          : option.label,
      image: designOptionImageSrc(option),
    })),
  ]
  return (
    <form.Field name={name as never}>
      {(field: any) => {
        const stored: string = field.state.value ?? ''
        const savedOption = options.find(
          (option) => option.category === category && option.slug === stored,
        )
        const known = stored === '' || savedOption != null
        return (
          <div className="space-y-1.5">
            <DesignOptionGrid
              options={items}
              value={stored}
              onChange={field.handleChange}
              columns={columns}
            />
            {!known && (
              <UnknownDesignValue
                value={stored}
                onClear={() => field.handleChange('')}
              />
            )}
            {savedOption && !savedOption.isActive && (
              <p className="text-xs text-muted-foreground">
                Saved option {savedOption.label} is retired. Its cost is
                included.
              </p>
            )}
          </div>
        )
      }}
    </form.Field>
  )
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
}: OrderBlockProps) {
  const base = `customers[${customerIndex}].orders[${orderIndex}]`
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
  React.useEffect(() => {
    if (!stockDefault || (materialSource === 'shop' && !pickedMaterial)) {
      return
    }
    const stocked =
      materialSource === 'customer' ||
      pickedMaterial?.locations.some(
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
    pickedMaterial,
    form,
    base,
    materialSource,
    customerIndex,
    orderIndex,
  ])
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
  const pricing =
    draft &&
    !designLoading &&
    !designError &&
    !(materialError && !hasPickedPrices)
      ? calculateGarmentPrice(draft, pricingMaterial, designOptions)
      : null
  const computedPrice = pricing?.total ?? ''
  const { data: pricingRules } = usePricing()
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

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Order {orderNumber}</h4>
        {removable && (
          <Button variant="ghost" size="sm" onClick={onRemove} type="button">
            <XIcon className="h-3.5 w-3.5" />
            Remove Order
          </Button>
        )}
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Thob Type</Label>
          <CatalogGrid
            form={form}
            name={`${base}.thobeType`}
            category="thob_type"
            options={designOptions}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Front Pocket</Label>
          <CatalogGrid
            form={form}
            name={`${base}.fPocket`}
            category="front_pocket"
            options={designOptions}
            columns={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Side Pocket</Label>
          <CatalogGrid
            form={form}
            name={`${base}.sPocket`}
            category="side_pocket"
            options={designOptions}
            columns={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Collar</Label>
          <CatalogGrid
            form={form}
            name={`${base}.collar`}
            category="neck"
            options={designOptions}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Sleeve</Label>
          <CatalogGrid
            form={form}
            name={`${base}.sleeve`}
            category="sleeve"
            options={designOptions}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Patti (Front Strip)</Label>
          <CatalogGrid
            form={form}
            name={`${base}.patti`}
            category="patti"
            options={designOptions}
            columns={2}
          />
        </div>

        <div className="space-y-1.5">
          <Label>EMD</Label>
          <CatalogGrid
            form={form}
            name={`${base}.emd`}
            category="emd"
            options={designOptions}
          />
        </div>

        {designLoading && (
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
            Loading design options...
          </p>
        )}

        <form.Field name={`${base}.moreDetails` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label htmlFor={field.name}>More Details</Label>
              <Textarea
                id={field.name}
                placeholder="e.g. double stitching on hem, rush order for Eid..."
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      </div>

      <div className="space-y-3">
        <Separator />
        <form.Field name={`${base}.materialSource` as never}>
          {(field: any) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Material supplied by</FieldLabel>
              <SegmentedOptions
                id={field.name}
                options={['Shop', 'Customer']}
                value={field.state.value === 'customer' ? 'Customer' : 'Shop'}
                onChange={(label) => {
                  const source = label === 'Customer' ? 'customer' : 'shop'
                  if (source === field.state.value) return
                  field.handleChange(source)
                  form.setFieldValue(`${base}.materialId` as never, '' as never)
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
                    getValueLabel={materialLabelForId}
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
                  {pickedMaterial && (
                    <p className="text-xs text-muted-foreground">
                      Available: {materialTotalStock(pickedMaterial)}{' '}
                      {pickedMaterial.unit}
                      {pickedMaterial.locations.length > 0 &&
                        ` — ${pickedMaterial.locations
                          .map(
                            (stock) => `${stock.location}: ${stock.quantity}`,
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
                      onValueChange={(value) => field.handleChange(value ?? '')}
                      placeholder="Search production location..."
                      emptyMessage="No active production locations found."
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )
              }
              const stockOptions: StockLocationOption[] =
                pickedMaterial?.locations
                  .filter((stock) => stock.quantity > 0)
                  .map((stock) => ({
                    id: stock.locationId,
                    name: stock.location,
                    receivesOrders: false,
                    holdsStock: true,
                    isActive: true,
                    quantity: stock.quantity,
                    unit: pickedMaterial.unit,
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
                        {pickedMaterial
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
            {materialSource === 'customer' && (
              <NumberField
                form={form}
                name={`${base}.customerBasePrice`}
                label={`Tailoring base incl. VAT (${CURRENCY})`}
              />
            )}
            <form.Field name={`${base}.price` as never}>
              {(field: any) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel>Price incl. VAT ({CURRENCY})</FieldLabel>
                  <output
                    aria-label={`Price incl. VAT (${CURRENCY})`}
                    className="text-sm font-semibold"
                  >
                    {pricing ? `${CURRENCY} ${pricing.total.toFixed(2)}` : '—'}
                  </output>
                  {pricing ? (
                    <p className="text-xs text-muted-foreground">
                      {pricing.tier
                        ? `${pricing.tier[0].toUpperCase()}${pricing.tier.slice(1)}`
                        : 'Tailoring'}
                      : {pricing.base.toFixed(2)} + designs:{' '}
                      {pricing.designCost.toFixed(2)}
                    </p>
                  ) : (
                    <p
                      role={designError || materialError ? 'alert' : undefined}
                      className="text-xs text-muted-foreground"
                    >
                      {designError || materialError
                        ? 'Could not load pricing. Reload to try again.'
                        : 'Choose a priced material, quantity and valid designs, or enter a customer tailoring base.'}
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
    </div>
  )
}
