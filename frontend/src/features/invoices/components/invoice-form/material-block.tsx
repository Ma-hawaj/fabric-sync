import * as React from 'react'
import { XIcon } from 'lucide-react'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { NumberField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import type { Location } from '@/features/locations/types/location'
import { STOCK_FILTERS } from '@/features/locations/lib/location-filters'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { CURRENCY } from '@/lib/currency'
import type { InvoiceFormApi } from '../../types/invoice-form'
import type { Material } from '../../types/materials'
import { computeProductLineTotal } from '../../lib/invoice-pricing'
import { GrossVatHint } from './gross-vat-hint'

interface MaterialBlockProps {
  form: InvoiceFormApi
  lineIndex: number
  onMaterialPicked: (material: Material | null) => void
  initialMaterialForId: (id: string) => Material | null
  materialLabelForId: (id: string) => string | null
  locationLabelForId: (id: string) => string | null
  onRemove: () => void
}

export function MaterialBlock({
  form,
  lineIndex,
  onMaterialPicked,
  initialMaterialForId,
  materialLabelForId,
  locationLabelForId,
  onRemove,
}: MaterialBlockProps) {
  const base = `materials[${lineIndex}]`
  const stored = form.state.values.materials[lineIndex]
  const [picked, setPicked] = React.useState<Material | null>(() =>
    initialMaterialForId(stored.materialId),
  )
  const stockDefault = useApplicableDefaultLocation('stock')
  React.useEffect(() => {
    if (stockDefault && !form.state.values.materials[lineIndex]?.branchId) {
      form.setFieldValue(`${base}.branchId` as never, stockDefault.id as never)
    }
  }, [stockDefault, form, lineIndex, base])

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
              onValueChange={(id) => field.handleChange(id ?? '')}
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
        {(field: any) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>Sold From</FieldLabel>
            <AsyncCombobox<Location>
              id={field.name}
              endpoint="/locations"
              queryKey="invoice-material-location"
              searchField="name"
              filters={STOCK_FILTERS}
              toOption={(location) => ({
                value: location.id,
                label: location.name,
              })}
              getValueLabel={(id) =>
                locationLabelForId(id) ??
                (id === stockDefault?.id ? stockDefault.name : null)
              }
              value={field.state.value || null}
              onValueChange={(id) => field.handleChange(id ?? '')}
              placeholder="Search location..."
              emptyMessage="No locations found."
            />
            {picked && field.state.value && (
              <p className="text-xs text-muted-foreground">
                Available:{' '}
                {picked.locations.find(
                  (stock) => stock.locationId === field.state.value,
                )?.quantity ?? 0}{' '}
                {picked.unit}
              </p>
            )}
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
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
