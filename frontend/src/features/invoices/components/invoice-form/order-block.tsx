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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY } from '@/lib/currency'
import {
  FRONT_POCKET,
  NECK,
  PATTI,
  SLEEVE,
  THOB_TYPE,
} from '../../data/design-catalog'
import type { Location } from '@/features/locations/types/location'
import { materialTotalStock } from '../../types/materials'
import type { Material } from '../../types/materials'
import type { InvoiceFormApi } from '../../types/invoice-form'

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
        <form.Field name={`${base}.thobeType` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Thob Type</Label>
              <DesignOptionGrid
                options={THOB_TYPE}
                value={field.state.value}
                onChange={field.handleChange}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.fPocket` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Front Pocket</Label>
              <DesignOptionGrid
                options={FRONT_POCKET}
                value={field.state.value}
                onChange={field.handleChange}
                columns={2}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.collar` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Collar</Label>
              <DesignOptionGrid
                options={NECK}
                value={field.state.value}
                onChange={field.handleChange}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.sleeve` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Sleeve</Label>
              <DesignOptionGrid
                options={SLEEVE}
                value={field.state.value}
                onChange={field.handleChange}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.patti` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Patti (Front Strip)</Label>
              <DesignOptionGrid
                options={PATTI}
                value={field.state.value}
                onChange={field.handleChange}
                columns={2}
              />
            </div>
          )}
        </form.Field>

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
        <h4 className="text-sm font-semibold">Material</h4>
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

          <NumberField
            form={form}
            name={`${base}.price`}
            label={`Price (${CURRENCY})`}
          />
        </div>
      </div>
    </div>
  )
}
