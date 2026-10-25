import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { NumberField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'
import type { Material, MaterialLocationStock } from '../../types/materials'
import { computeProductLineTotal } from '../../lib/invoice-pricing'
import { GrossVatHint } from './gross-vat-hint'

interface MaterialBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  onMaterialPicked: (material: Material | null) => void
  initialMaterialForId: (id: string) => Material | null
  materialLabelForId: (id: string) => string | null
  onRemove: () => void
}

export function MaterialBlock({
  form,
  lineIndex,
  onMaterialPicked,
  initialMaterialForId,
  materialLabelForId,
  onRemove,
}: MaterialBlockProps) {
  const base = `materials[${lineIndex}]`
  const stored = form.state.values.materials[lineIndex]
  const [picked, setPicked] = useState<Material | null>(() =>
    initialMaterialForId(stored.materialId),
  )
  const stockDefault = useApplicableDefaultLocation('stock')
  useEffect(() => {
    if (
      stockDefault &&
      picked?.locations.some(
        (stock) => stock.locationId === stockDefault.id && stock.quantity > 0,
      ) &&
      !form.state.values.materials[lineIndex]?.branchId
    ) {
      form.setFieldValue(`${base}.branchId` as never, stockDefault.id as never)
    }
  }, [stockDefault, picked, form, lineIndex, base])

  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
      <form.Field name={`${base}.materialId` as never}>
        {(field: any) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>Material</FieldLabel>
            <AsyncCombobox<Material>
              id={field.name}
              endpoint="/materials"
              queryKey="invoice-material"
              searchField="name"
              toOption={(material) => ({
                value: material.id,
                label: material.name,
              })}
              getValueLabel={materialLabelForId}
              value={field.state.value || null}
              onValueChange={(id) => {
                field.handleChange(id ?? '')
                form.setFieldValue(`${base}.branchId` as never, '' as never)
              }}
              onSelectRow={(material) => {
                setPicked(material)
                onMaterialPicked(material)
              }}
              placeholder="Search material..."
              emptyMessage="No materials found."
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name={`${base}.branchId` as never}>
        {(field: any) => {
          // Preserve a saved location even when this sale exhausted its stock.
          const locations =
            picked?.locations.filter(
              (stock) =>
                stock.quantity > 0 || stock.locationId === field.state.value,
            ) ?? []
          const selected =
            locations.find((stock) => stock.locationId === field.state.value) ??
            null
          const locationLabel = (stock: MaterialLocationStock) =>
            `${stock.location} — ${stock.quantity} ${picked?.unit ?? ''}`
          return (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Sold From</FieldLabel>
              <Combobox
                items={locations}
                itemToStringLabel={locationLabel}
                isItemEqualToValue={(
                  a: MaterialLocationStock,
                  b: MaterialLocationStock,
                ) => a.locationId === b.locationId}
                value={selected}
                onValueChange={(location: MaterialLocationStock | null) =>
                  field.handleChange(location?.locationId ?? '')
                }
              >
                <ComboboxInput
                  id={field.name}
                  placeholder="Search location..."
                  className="w-full"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>
                    {picked
                      ? 'This material has no stock available.'
                      : 'Pick a material first.'}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(stock: MaterialLocationStock) => (
                      <ComboboxItem key={stock.locationId} value={stock}>
                        {locationLabel(stock)}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {picked && selected && (
                <p className="text-xs text-muted-foreground">
                  Available: {selected.quantity} {picked.unit}
                </p>
              )}
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )
        }}
      </form.Field>
      <NumberField
        form={form}
        name={`${base}.quantity`}
        label={`Quantity${picked ? ` (${picked.unit})` : ''}`}
      />
      <NumberField
        form={form}
        name={`${base}.unitPrice`}
        label={`Price per unit, incl. VAT (${CURRENCY})`}
      />
      <form.Subscribe
        selector={(state: any) => state.values.materials[lineIndex]}
      >
        {(line: any) =>
          line && (
            <div className="text-sm sm:col-span-2 lg:col-span-3">
              Line total: {CURRENCY} {computeProductLineTotal(line).toFixed(2)}
              <GrossVatHint gross={computeProductLineTotal(line)} />
            </div>
          )
        }
      </form.Subscribe>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onRemove}
        aria-label="Remove material"
      >
        <XIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
