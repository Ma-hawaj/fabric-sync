import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NumberField } from '@/components/form/fields'
import { AsyncCombobox } from '@/components/form/async-combobox'
import type { AnyFormApi } from '@/components/form/fields'
import { STOCK_FILTERS } from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'

// Typed as AnyFormApi rather than InventoryFormApi because the products form
// reuses this row over its own `entries` array — see the comment atop
// components/form/fields.tsx for why these props stay loosely typed.
interface StockEntryRowProps {
  form: AnyFormApi
  entryIndex: number
  removable: boolean
  onRemove: () => void
}

export function StockEntryRow({
  form,
  entryIndex,
  removable,
  onRemove,
}: StockEntryRowProps) {
  const base = `entries[${entryIndex}]`

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.locationId` as never}>
        {(field: any) => (
          <Field
            data-invalid={field.state.meta.errors.length > 0}
            className="flex-1"
          >
            <FieldLabel htmlFor={field.name}>Location</FieldLabel>
            <AsyncCombobox<Location>
              id={field.name}
              endpoint="/locations"
              queryKey="stock-entry-locations"
              searchField="name"
              filters={STOCK_FILTERS}
              placeholder="Search location..."
              emptyMessage="No locations found."
              toOption={(location) => ({
                value: location.id,
                label: location.name,
              })}
              value={field.state.value || null}
              onValueChange={(locationId) =>
                field.handleChange(locationId ?? '')
              }
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <div className="flex-1">
        <NumberField form={form} name={`${base}.quantity`} label="Quantity" />
      </div>

      {removable && (
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={onRemove}
          className="mt-6"
          aria-label="Remove location"
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
