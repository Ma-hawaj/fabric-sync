import * as React from 'react'
import { XIcon } from 'lucide-react'
import { NumberField } from '@/components/form/fields'
import { DesignOptionGrid } from '@/components/form/design-option-grid'
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
import type { InvoiceFormApi } from '../../types/invoice-form'

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
      or keep it — it still prints as text.
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
  const items = selectCategoryOptions(options, category).map((option) => ({
    id: option.slug,
    label: option.label,
    image: designOptionImageSrc(option),
  }))
  return (
    <form.Field name={name as never}>
      {(field: any) => {
        const stored: string = field.state.value ?? ''
        const known = stored === '' || items.some((item) => item.id === stored)
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
  onRemove,
  removable,
}: OrderBlockProps) {
  const base = `customers[${customerIndex}].orders[${orderIndex}]`
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
  const [pickedMaterial, setPickedMaterial] = React.useState<Material | null>(
    () =>
      storedMaterialId
        ? (initialMaterialForId?.(storedMaterialId) ?? null)
        : null,
  )
  // A garment can only be made where its material is stocked, so the default
  // applies here only when it is one of the picked material's in-stock
  // locations. Runs on every material change (the material picker clears Made
  // At itself) but never overwrites a value already chosen.
  const stockDefault = useApplicableDefaultLocation('stock')
  React.useEffect(() => {
    if (!stockDefault || !pickedMaterial) {
      return
    }
    const stocked = pickedMaterial.locations.some(
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
  }, [stockDefault, pickedMaterial, form, base])
  // The whole design catalog, shared across every order block on the form —
  // one cached request for all seven pickers, however many orders there are.
  const { data: designOptions = [], isLoading: designLoading } =
    useDesignOptions()

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
                        .map((stock) => `${stock.location}: ${stock.quantity}`)
                        .join(', ')}`}
                  </p>
                )}
              </Field>
            )}
          </form.Field>

          {/* A material can only be made at a location where it is in
              stock — so this picker lists the selected material's stock
              locations rather than every stock-holding branch. */}
          <form.Field name={`${base}.productionLocationId` as never}>
            {(field: any) => {
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

          <div>
            <NumberField
              form={form}
              name={`${base}.price`}
              label={`Price incl. VAT (${CURRENCY})`}
            />
            {/* Prices are entered gross — the hint splits what was typed
                into net and VAT so staff quote knowing both. */}
            <form.Subscribe
              selector={(state: any) =>
                state.values.customers[customerIndex]?.orders[orderIndex]
                  ?.price ?? ''
              }
            >
              {(price: number | '') => <GrossVatHint gross={price} />}
            </form.Subscribe>
          </div>
        </div>
      </div>
    </div>
  )
}
