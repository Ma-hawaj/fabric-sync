import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { ApiError } from '@/features/customers/hooks/use-create-customer'
import { useCreateLocation } from './hooks/use-create-location'
import { useLocations } from './hooks/use-locations'
import { useUpdateLocation } from './hooks/use-update-location'
import { locationFormSchema } from './lib/location-schema'
import {
  createEmptyLocationForm,
  locationToFormValues,
} from './types/location-form'
import type { Location } from './types/location'
import type { LocationFormValues } from './types/location-form'

// The two capability flags are independent in the data model, but "neither" is
// rejected by both the schema and the backend — so the three usable
// combinations present better as one choice than as two checkboxes.
const ORDERS_ONLY = 'Customer orders'
const STOCK_ONLY = 'Material stock'
const BOTH = 'Both'
const USE_OPTIONS = [ORDERS_ONLY, STOCK_ONLY, BOTH] as const

function usageLabel(
  values: Pick<LocationFormValues, 'receivesOrders' | 'holdsStock'>,
) {
  if (values.receivesOrders && values.holdsStock) return BOTH
  return values.receivesOrders ? ORDERS_ONLY : STOCK_ONLY
}

export function LocationFormPage({ locationId }: { locationId?: string }) {
  const { data: locations = [], isLoading } = useLocations()
  const existing = locationId
    ? locations.find((location) => location.id === locationId)
    : undefined

  if (locationId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading location...
      </div>
    )
  }

  if (locationId && !existing) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That location could not be found.
      </div>
    )
  }

  // Keyed so the form re-initialises if the underlying location changes —
  // defaultValues is only read on the first render.
  return <LocationForm key={existing?.id ?? 'new'} existing={existing} />
}

function LocationForm({ existing }: { existing?: Location }) {
  const navigate = useNavigate()
  const createLocation = useCreateLocation()
  const updateLocation = useUpdateLocation()
  const mutation = existing ? updateLocation : createLocation

  const form = useForm({
    defaultValues: existing
      ? locationToFormValues(existing)
      : createEmptyLocationForm(),
    validators: { onSubmit: locationFormSchema },
    onSubmit: async ({ value }) => {
      const pending = existing
        ? updateLocation.mutateAsync({ id: existing.id, ...value })
        : createLocation.mutateAsync(value)

      toast.promise(pending, {
        loading: existing ? 'Saving location...' : 'Adding location...',
        success: (location) =>
          existing
            ? `${location.name} was updated.`
            : `${location.name} was added.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A location with this name already exists.'
            : 'Could not save this location. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/locations' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? 'Edit Location' : 'Add Location'}
        </h1>
        <p className="text-muted-foreground">
          Choose what this location is used for — customers can only be sent to
          collect orders from locations that receive them.
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
          <TextField form={form} name="name" label="Location Name" />

          <form.Subscribe
            selector={(state) =>
              [state.values.receivesOrders, state.values.holdsStock] as const
            }
          >
            {([receivesOrders, holdsStock]) => (
              <form.Field name="receivesOrders">
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={field.name}>Used For</FieldLabel>
                    <SegmentedOptions
                      id={field.name}
                      options={USE_OPTIONS}
                      value={usageLabel({ receivesOrders, holdsStock })}
                      onChange={(label) => {
                        field.handleChange(
                          label === ORDERS_ONLY || label === BOTH,
                        )
                        form.setFieldValue(
                          'holdsStock',
                          label === STOCK_ONLY || label === BOTH,
                        )
                      }}
                      columns={3}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          {existing && (
            <form.Field name="isActive">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Status</FieldLabel>
                  <SegmentedOptions
                    id={field.name}
                    options={['Active', 'Inactive']}
                    value={field.state.value ? 'Active' : 'Inactive'}
                    onChange={(label) => field.handleChange(label === 'Active')}
                    columns={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Inactive locations stay on this page but stop appearing in
                    the invoice and inventory pickers.
                  </p>
                </Field>
              )}
            </form.Field>
          )}
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
            onClick={() => navigate({ to: '/locations' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
