import { XIcon } from 'lucide-react'
import { NumberField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
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
import {
  COLLARS,
  FRONT_POCKETS,
  PATTIS,
  SLEEVES,
  THOBE_TYPES,
} from '../../data/invoice-form-options'
import { materialTotalStock } from '../../types/materials'
import type { Material } from '../../types/materials'
import type { InvoiceFormApi } from '../../types/invoice-form'

function materialOptionLabel(material: Material) {
  return material.sku ? `${material.name} (${material.sku})` : material.name
}

interface OrderBlockProps {
  form: InvoiceFormApi
  customerIndex: number
  orderIndex: number
  orderNumber: number
  materials: Material[]
  onRemove: () => void
  removable: boolean
}

export function OrderBlock({
  form,
  customerIndex,
  orderIndex,
  orderNumber,
  materials,
  onRemove,
  removable,
}: OrderBlockProps) {
  const base = `customers[${customerIndex}].orders[${orderIndex}]`

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
              <SegmentedOptions
                options={THOBE_TYPES}
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
              <SegmentedOptions
                options={FRONT_POCKETS}
                value={field.state.value}
                onChange={field.handleChange}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.collar` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Collar</Label>
              <SegmentedOptions
                options={COLLARS}
                value={field.state.value}
                onChange={field.handleChange}
                columns={2}
              />
            </div>
          )}
        </form.Field>

        <form.Field name={`${base}.sleeve` as never}>
          {(field: any) => (
            <div className="space-y-1.5">
              <Label>Sleeve</Label>
              <SegmentedOptions
                options={SLEEVES}
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
              <SegmentedOptions
                options={PATTIS}
                value={field.state.value}
                onChange={field.handleChange}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <form.Field name={`${base}.materialId` as never}>
            {(field: any) => {
              const selected = materials.find((m) => m.id === field.state.value)
              return (
                <Field
                  className="lg:col-span-2"
                  data-invalid={field.state.meta.errors.length > 0}
                >
                  <FieldLabel htmlFor={field.name}>Material</FieldLabel>
                  <Combobox
                    items={materials}
                    itemToStringLabel={materialOptionLabel}
                    isItemEqualToValue={(a: Material, b: Material) =>
                      a.id === b.id
                    }
                    value={selected ?? null}
                    onValueChange={(material: Material | null) =>
                      field.handleChange(material?.id ?? '')
                    }
                  >
                    <ComboboxInput
                      id={field.name}
                      placeholder="Search material by name or SKU..."
                      className="w-full"
                      showClear
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No materials found.</ComboboxEmpty>
                      <ComboboxList>
                        {(material: Material) => (
                          <ComboboxItem key={material.id} value={material}>
                            {materialOptionLabel(material)}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldError errors={field.state.meta.errors} />
                  {selected && (
                    <p className="text-xs text-muted-foreground">
                      Available: {materialTotalStock(selected)} {selected.unit}
                      {selected.locations.length > 0 &&
                        ` — ${selected.locations
                          .map(
                            (stock) => `${stock.location}: ${stock.quantity}`,
                          )
                          .join(', ')}`}
                    </p>
                  )}
                </Field>
              )
            }}
          </form.Field>

          <NumberField
            form={form}
            name={`${base}.materialAmount`}
            label="Quantity (m)"
          />

          <NumberField form={form} name={`${base}.price`} label="Price (SAR)" />
        </div>
      </div>
    </div>
  )
}
