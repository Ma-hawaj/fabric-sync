import { XIcon } from 'lucide-react'
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
import { NumberField } from '@/components/form/fields'
import type { Location } from '@/features/locations/types/location'
import type { InventoryFormApi } from '../types/inventory-form'

interface StockEntryRowProps {
  form: InventoryFormApi
  entryIndex: number
  locations: Location[]
  removable: boolean
  onRemove: () => void
}

export function StockEntryRow({
  form,
  entryIndex,
  locations,
  removable,
  onRemove,
}: StockEntryRowProps) {
  const base = `entries[${entryIndex}]`

  return (
    <div className="flex items-start gap-3">
      <form.Field name={`${base}.locationId` as never}>
        {(field: any) => {
          const selected = locations.find((l) => l.id === field.state.value)
          return (
            <Field
              data-invalid={field.state.meta.errors.length > 0}
              className="flex-1"
            >
              <FieldLabel htmlFor={field.name}>Location</FieldLabel>
              <Combobox
                items={locations}
                itemToStringLabel={(location: Location) => location.name}
                isItemEqualToValue={(a: Location, b: Location) => a.id === b.id}
                value={selected ?? null}
                onValueChange={(location: Location | null) =>
                  field.handleChange(location?.id ?? '')
                }
              >
                <ComboboxInput
                  id={field.name}
                  placeholder="Search location..."
                  className="w-full"
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>No locations found.</ComboboxEmpty>
                  <ComboboxList>
                    {(location: Location) => (
                      <ComboboxItem key={location.id} value={location}>
                        {location.name}
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
