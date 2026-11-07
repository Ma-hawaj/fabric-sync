import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { ApiError } from '@/lib/api'
import { useCreateLocation } from './hooks/use-create-location'
import { useLocation } from './hooks/use-location'
import { useUpdateLocation } from './hooks/use-update-location'
import { locationFormSchema } from './lib/location-schema'
import {
  createEmptyLocationForm,
  locationToFormValues,
} from './types/location-form'
import type { Location } from './types/location'

export function LocationFormPage({ locationId }: { locationId?: string }) {
  const { data: existing, isLoading, isError } = useLocation(locationId ?? null)

  if (locationId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading location...
      </div>
    )
  }

  if (locationId && (isError || !existing)) {
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
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {existing ? 'Edit Location' : 'Add Location'}
        </h1>
        <p className="text-muted-foreground">
          Choose pickup, stock, and production capabilities independently.
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

          <div className="space-y-3" role="group" aria-label="Used For">
            {(
              [
                { name: 'receivesOrders', label: 'Receives orders' },
                { name: 'holdsStock', label: 'Holds stock' },
                { name: 'producesOrders', label: 'Produces orders' },
              ] as const
            ).map(({ name, label }) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={field.name}
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked === true)
                        }
                      />
                      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
                    </div>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            ))}
          </div>

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
