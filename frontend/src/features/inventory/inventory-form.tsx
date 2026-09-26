import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import * as React from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TextField } from '@/components/form/fields'
import { AsyncCombobox } from '@/components/form/async-combobox'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { StockEntryRow } from './components/stock-entry-row'
import { useApplicableDefaultLocation } from '@/features/locations/hooks/use-default-location'
import { UNITS } from './data/inventory-options'
import { useAddStock } from './hooks/use-add-stock'
import { inventoryFormSchema } from './lib/inventory-schema'
import {
  createEmptyInventoryForm,
  createEmptyStockEntry,
} from './types/inventory-form'
import type { StockEntryMode } from './types/inventory-form'
import type { Material } from './types/inventory'

function materialOptionLabel(material: Material) {
  return material.sku ? `${material.name} (${material.sku})` : material.name
}

export function InventoryFormPage() {
  const navigate = useNavigate()
  const addStock = useAddStock()

  const form = useForm({
    defaultValues: createEmptyInventoryForm(),
    validators: { onSubmit: inventoryFormSchema },
    onSubmit: async ({ value }) => {
      const pending = addStock.mutateAsync(value)
      toast.promise(pending, {
        loading:
          value.mode === 'existing' ? 'Adding stock...' : 'Adding material...',
        success: value.mode === 'existing' ? 'Stock added.' : 'Material added.',
        error: 'Could not save this stock. Please try again.',
      })

      await pending
      await navigate({ to: '/inventory' })
    },
  })

  // The default location pre-fills the first stock row when it holds stock.
  // Only row zero, and only while empty — further "Add Another Location" rows
  // stay blank (each location may appear once), and a choice already made is
  // never overwritten by a late-arriving default.
  const stockDefault = useApplicableDefaultLocation('stock')
  React.useEffect(() => {
    if (stockDefault && form.state.values.entries[0]?.locationId === '') {
      form.setFieldValue(
        'entries[0].locationId' as never,
        stockDefault.id as never,
      )
    }
  }, [stockDefault, form])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add Stock</h1>
        <p className="text-muted-foreground">
          Add stock to an existing material or register a new material, across
          one or more locations at once.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <form.Field name="mode">
            {(modeField) => (
              <SegmentedOptions
                options={['Add to Existing Material', 'New Material']}
                value={
                  modeField.state.value === 'existing'
                    ? 'Add to Existing Material'
                    : 'New Material'
                }
                onChange={(label) =>
                  modeField.handleChange(
                    (label === 'Add to Existing Material'
                      ? 'existing'
                      : 'new') satisfies StockEntryMode,
                  )
                }
                columns={2}
              />
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.mode}>
            {(mode) =>
              mode === 'existing' ? (
                <form.Field name="materialId">
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={field.name}>Material</FieldLabel>
                      <AsyncCombobox<Material>
                        id={field.name}
                        endpoint="/materials"
                        queryKey="inventory-material-picker"
                        searchField={['name', 'sku']}
                        placeholder="Search material by name or SKU..."
                        emptyMessage="No materials found."
                        toOption={(material) => ({
                          value: material.id,
                          label: materialOptionLabel(material),
                        })}
                        value={field.state.value || null}
                        onValueChange={(materialId) =>
                          field.handleChange(materialId ?? '')
                        }
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField form={form} name="name" label="Name" />
                    <TextField form={form} name="sku" label="SKU" />
                  </div>

                  <form.Field name="unit">
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={field.name}>Unit</FieldLabel>
                        <Select
                          value={field.state.value}
                          onValueChange={(value: string | null) =>
                            field.handleChange(value ?? '')
                          }
                        >
                          <SelectTrigger id={field.name} className="w-full">
                            <SelectValue placeholder="Select unit..." />
                          </SelectTrigger>
                          <SelectContent>
                            {UNITS.map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>
              )
            }
          </form.Subscribe>

          <form.Field name="entries">
            {(entriesField) => (
              <div className="space-y-3">
                <FieldLabel>Locations</FieldLabel>
                {entriesField.state.value.map((entry, index) => (
                  <StockEntryRow
                    key={entry.key}
                    form={form as never}
                    entryIndex={index}
                    removable={entriesField.state.value.length > 1}
                    onRemove={() => entriesField.removeValue(index)}
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    entriesField.pushValue(createEmptyStockEntry())
                  }
                  className="w-full border-dashed"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add Another Location
                </Button>
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([submissionAttempts, isValid]) =>
            submissionAttempts > 0 &&
            !isValid && (
              <p className="text-sm font-medium text-destructive">
                Please fix the highlighted fields before saving.
              </p>
            )
          }
        </form.Subscribe>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/inventory' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={addStock.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
