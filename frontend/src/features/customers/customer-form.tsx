import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TextField, PhoneField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { MeasurementFields } from './components/measurement-fields'
import { useAllCustomers } from './hooks/use-customers'
import { useCreateCustomer } from './hooks/use-create-customer'
import { useUpdateCustomer } from './hooks/use-update-customer'
import { customerFormSchema } from './lib/customer-schema'
import {
  createEmptyCustomerForm,
  customerToFormValues,
} from './types/customer-form'
import type { Customer } from './types/customers'
import { ApiError } from '@/lib/api'

export function CustomerFormPage({ customerId }: { customerId?: string }) {
  const { data: customers, isLoading } = useAllCustomers()
  const existing = customerId
    ? customers.find((customer) => customer.id === customerId)
    : undefined

  if (customerId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading customer...
      </div>
    )
  }

  if (customerId && !existing) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That customer could not be found.
      </div>
    )
  }

  // Keyed so the form re-initialises if the underlying customer changes —
  // defaultValues is only read on the first render.
  return <CustomerForm key={existing?.id ?? 'new'} existing={existing} />
}

function CustomerForm({ existing }: { existing?: Customer }) {
  const navigate = useNavigate()
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const mutation = existing ? updateCustomer : createCustomer

  const form = useForm({
    defaultValues: existing
      ? customerToFormValues(existing)
      : createEmptyCustomerForm(),
    validators: { onSubmit: customerFormSchema },
    onSubmit: async ({ value }) => {
      const pending = existing
        ? updateCustomer.mutateAsync({
            id: existing.id,
            name: value.name,
            mobileNo: value.mobileNo,
          })
        : createCustomer.mutateAsync(value)
      toast.promise(pending, {
        loading: existing ? 'Saving customer...' : 'Adding customer...',
        success: (customer) =>
          existing
            ? `${customer.name} was updated.`
            : `${customer.name} was added.`,
        error: (error) =>
          error instanceof ApiError && error.status === 409
            ? 'A customer with this name and phone number already exists.'
            : 'Could not save this customer. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/customers' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {existing ? 'Edit Customer' : 'Add Customer'}
        </h1>
        <p className="text-muted-foreground">
          {existing
            ? 'Update this customer’s name and phone number. Measurements are kept as they are.'
            : 'Register a new customer so they can be selected on invoices and orders.'}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          void form.handleSubmit()
        }}
        className="max-w-5xl space-y-6"
      >
        <div className="max-w-3xl space-y-4 rounded-xl border border-border/60 bg-card p-5">
          <TextField form={form} name="name" label="Full Name" />
          <PhoneField form={form} name="mobileNo" label="Phone" />
        </div>

        {!existing && (
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
        )}

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
            onClick={() => navigate({ to: '/customers' })}
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
