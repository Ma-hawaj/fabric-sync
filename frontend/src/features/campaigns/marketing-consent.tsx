import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useMarketingConsent, useCampaignMutation } from './hooks'
import { errorMessage } from './components'
import type { ConsentResponse } from './types'

export function MarketingConsentPanel({ customerId }: { customerId: string }) {
  return (
    <PermissionGuard method="PUT" path="/customers/:id/marketing-consent">
      <ConsentPanel customerId={customerId} />
    </PermissionGuard>
  )
}
function ConsentPanel({ customerId }: { customerId: string }) {
  const consent = useMarketingConsent(customerId)
  if (consent.isError)
    return <p role="alert">Could not load the promotions preference.</p>
  if (!consent.data) return <p>Loading promotions preference...</p>
  if (!consent.data.mobile)
    return <p>Save a valid mobile number to set the promotions preference.</p>
  return (
    <ConsentForm
      key={`${consent.data.mobile}-${consent.data.consent?.version ?? 'unknown'}`}
      customerId={customerId}
      current={consent.data}
    />
  )
}
function ConsentForm({
  customerId,
  current,
}: {
  customerId: string
  current: ConsentResponse
}) {
  const mutation = useCampaignMutation<ConsentResponse>()
  const form = useForm({
    defaultValues: {
      granted: current.consent?.granted ?? true,
    },
    validators: {
      onSubmit: z.object({
        granted: z.boolean(),
      }),
    },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path: `/customers/${customerId}/marketing-consent`,
        method: 'put',
        body: { granted: value.granted, expectedMobile: current.mobile },
      })
      toast.promise(pending, {
        loading: 'Saving promotions preference...',
        success: 'Promotions preference saved.',
        error: errorMessage,
      })
      try {
        await pending
      } catch {
        return
      }
    },
  })
  return (
    <section className="max-w-3xl space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-medium">WhatsApp promotions</h2>
        <p className="text-sm text-muted-foreground">
          For saved number {current.mobile}. Applies to every customer sharing
          this number.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Field name="granted">
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
        <p className="text-xs text-muted-foreground">
          Save to apply this preference separately from customer details.
        </p>
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(mutation.error)}
          </p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          Save preference
        </Button>
      </form>
    </section>
  )
}
