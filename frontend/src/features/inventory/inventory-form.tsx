import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NumberField, TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { LOCATIONS, UNITS } from './data/inventory-options'
import { useAddStock } from './hooks/use-add-stock'
import { useInventory } from './hooks/use-inventory'
import { inventoryFormSchema } from './lib/inventory-schema'
import { createEmptyInventoryForm } from './types/inventory-form'
import type { StockEntryMode } from './types/inventory-form'

export function InventoryFormPage() {
  const navigate = useNavigate()
  const { data: materials = [] } = useInventory()
  const addStock = useAddStock()

  const form = useForm({
    defaultValues: createEmptyInventoryForm(),
    validators: { onSubmit: inventoryFormSchema },
    onSubmit: async ({ value }) => {
      await addStock.mutateAsync(value)
      await navigate({ to: '/inventory' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add Stock</h1>
        <p className="text-muted-foreground">
          Add stock to an existing material or register a new material.
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
                      <Select
                        items={materials.map((material) => ({
                          value: material.id,
                          label: `${material.name} (${material.sku})`,
                        }))}
                        value={field.state.value}
                        onValueChange={(value: string) =>
                          field.handleChange(value)
                        }
                      >
                        <SelectTrigger id={field.name} className="w-full">
                          <SelectValue placeholder="Select material..." />
                        </SelectTrigger>
                        <SelectContent>
                          {materials.map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.name} ({material.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                          onValueChange={(value: string) =>
                            field.handleChange(value)
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

          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="location">
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={field.name}>Location</FieldLabel>
                  <Select
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

            <NumberField form={form} name="quantity" label="Quantity" />
          </div>
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
