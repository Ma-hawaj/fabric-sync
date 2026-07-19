import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { MeasurementFields } from './components/measurement-fields'
import { ApiError, useCreateCustomer } from './hooks/use-create-customer'
import { customerFormSchema } from './lib/customer-schema'
import { createEmptyCustomerForm } from './types/customer-form'

export function CustomerFormPage() {
  const navigate = useNavigate()
  const createCustomer = useCreateCustomer()

  const form = useForm({
    defaultValues: createEmptyCustomerForm(),
    validators: { onSubmit: customerFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await createCustomer.mutateAsync(value)
      } catch {
        return
      }
      await navigate({ to: '/customers' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add Customer</h1>
        <p className="text-muted-foreground">
          Register a new customer so they can be selected on invoices and
          orders.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-3xl space-y-6"
      >
        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <TextField form={form} name="name" label="Full Name" />
          <TextField form={form} name="mobileNo" label="Phone" />
        </div>

        <div className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <form.Field name="addMeasurement">
            {(field) => (
              <SegmentedOptions
                options={['Skip Measurements', 'Add Measurements']}
                value={
                  field.state.value ? 'Add Measurements' : 'Skip Measurements'
                }
                onChange={(label) =>
                  field.handleChange(label === 'Add Measurements')
                }
                columns={2}
              />
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.addMeasurement}>
            {(addMeasurement) =>
              addMeasurement && (
                <MeasurementFields
                  form={form}
                  basePath="measurement"
                  history={[]}
                />
              )
            }
          </form.Subscribe>
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

        {createCustomer.isError && (
          <p className="text-sm font-medium text-destructive">
            {createCustomer.error instanceof ApiError &&
            createCustomer.error.status === 409
              ? 'A customer with this name and phone number already exists.'
              : 'Could not save this customer. Please try again.'}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/customers' })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={createCustomer.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
