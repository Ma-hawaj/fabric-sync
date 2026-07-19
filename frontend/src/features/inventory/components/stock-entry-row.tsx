import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField } from '@/components/form/fields'
import { LOCATIONS } from '../data/inventory-options'
import type { InventoryFormApi } from '../types/inventory-form'

interface StockEntryRowProps {
  form: InventoryFormApi
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
      <form.Field name={`${base}.location` as never}>
        {(field: any) => (
          <Field
            data-invalid={field.state.meta.errors.length > 0}
            className="flex-1"
          >
            <FieldLabel htmlFor={field.name}>Location</FieldLabel>
            <Select
              items={LOCATIONS.map((location) => ({
                value: location,
                label: location,
              }))}
              value={field.state.value}
              onValueChange={(value: string) => field.handleChange(value)}
            >
              <SelectTrigger id={field.name} className="w-full">
                <SelectValue placeholder="Select location..." />
              </SelectTrigger>
              <SelectContent>
                {LOCATIONS.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
