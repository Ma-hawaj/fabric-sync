import { useMarketingConsent } from '@/features/campaigns/hooks'
import type { ConsentResponse } from '@/features/campaigns/types'
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TextField, PhoneField, TextareaField } from '@/components/form/fields'
import { SegmentedOptions } from '@/components/form/segmented-options'
import { MeasurementFields } from './components/measurement-fields'
import { useCustomer } from './hooks/use-customer'
import { useCreateCustomer } from './hooks/use-create-customer'
import { useUpdateCustomer } from './hooks/use-update-customer'
import { customerFormSchema } from './lib/customer-schema'
import {
  createEmptyCustomerForm,
  customerToFormValues,
} from './types/customer-form'
import type { Customer } from './types/customers'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { canAccess } from '@/lib/permissions'

export function CustomerFormPage({ customerId }: { customerId?: string }) {
  const { user } = useAuth()
  const canEditMarketing = canAccess(
    user,
    'PUT',
    '/customers/customer/marketing-consent',
  )
  const marketing = useMarketingConsent(
    canEditMarketing ? (customerId ?? null) : null,
  )
  const { data: existing, isLoading, isError } = useCustomer(customerId ?? null)

  if (customerId && isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading customer...
      </div>
    )
  }

  if (customerId && (isError || !existing)) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        That customer could not be found.
      </div>
    )
  }

  if (customerId && canEditMarketing && marketing.isError) {
    return (
      <div role="alert" className="space-y-3">
        <p>Could not load WhatsApp preferences.</p>
        <Button variant="outline" onClick={() => void marketing.refetch()}>
          Retry
        </Button>
      </div>
    )
  }
  if (customerId && canEditMarketing && !marketing.data)
    return <p>Loading WhatsApp preferences...</p>

  // Keyed so the form re-initialises if the underlying customer changes —
  // defaultValues is only read on the first render.
  return (
    <CustomerForm
      key={existing?.id ?? 'new'}
      existing={existing}
      marketing={marketing.data ?? null}
      canEditMarketing={canEditMarketing}
    />
  )
}

function CustomerForm({
  existing,
  marketing: loadedMarketing,
  canEditMarketing,
}: {
  existing?: Customer
  marketing: ConsentResponse | null
  canEditMarketing: boolean
}) {
  // Keep the version paired with the values originally loaded into this form.
  // Background refreshes must not turn a routine edit into a re-subscription.
  const [marketing] = useState(loadedMarketing)
  const navigate = useNavigate()
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const mutation = existing ? updateCustomer : createCustomer

  const form = useForm({
    defaultValues: existing
      ? customerToFormValues(existing, marketing?.consent?.granted ?? true)
      : createEmptyCustomerForm(),
    validators: { onSubmit: customerFormSchema },
    onSubmit: async ({ value }) => {
      const marketingPreference =
        canEditMarketing &&
        (!existing ||
          !marketing?.consent ||
          value.whatsappMarketingEnabled !== marketing.consent.granted ||
          value.mobileNo !== existing.mobileNo)
          ? {
              granted: value.whatsappMarketingEnabled,
              expectedMobile: marketing?.mobile ?? null,
              expectedVersion: marketing?.consent?.version ?? null,
            }
          : undefined
      const pending = existing
        ? updateCustomer.mutateAsync({
            id: existing.id,
            name: value.name,
            mobileNo: value.mobileNo,
            whatsappNotificationsEnabled: value.whatsappNotificationsEnabled,
            ...(marketingPreference ? { marketingPreference } : {}),
            address: value.address,
          })
        : createCustomer.mutateAsync({ ...value, marketingPreference })
      toast.promise(pending, {
        loading: existing ? 'Saving customer...' : 'Adding customer...',
        success: (customer) =>
          existing
            ? `${customer.name} was updated.`
            : `${customer.name} was added.`,
        error: (error) =>
          error instanceof ApiError
            ? error.status === 409 && !error.message.includes('Reload')
              ? 'A customer with this name and phone number already exists.'
              : error.message
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
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {existing ? 'Edit Customer' : 'Add Customer'}
        </h1>
        <p className="text-muted-foreground">
          {existing
            ? 'Update this customer’s details and WhatsApp preferences. Measurements are kept as they are.'
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
          <PhoneField
            form={form}
            name="mobileNo"
            label="Phone"
            defaultCountry="BH"
          />
          <TextareaField
            form={form}
            name="address"
            label="Address (optional)"
          />
          <form.Field name="whatsappNotificationsEnabled">
            {(field) => (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={field.state.value}
                  disabled={mutation.isPending}
                  onCheckedChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
                Receive invoice and pickup updates via WhatsApp
              </label>
            )}
          </form.Field>
          {canEditMarketing && (
            <form.Field name="whatsappMarketingEnabled">
              {(field) => (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={field.state.value}
                    disabled={mutation.isPending}
                    onCheckedChange={field.handleChange}
                    onBlur={field.handleBlur}
                  />
                  Receive promotional offers via WhatsApp
                </label>
              )}
            </form.Field>
          )}
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
