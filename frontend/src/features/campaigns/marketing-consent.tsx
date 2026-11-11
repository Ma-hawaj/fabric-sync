import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { TextareaField } from '@/components/form/fields'
import {
  useMarketingConsent,
  useCampaignCapabilities,
  useCampaignMutation,
} from './hooks'
import { SimpleField, errorMessage } from './components'
import { businessTime, fromBusinessTime } from './lib/business-time'
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
  const capabilities = useCampaignCapabilities()
  if (consent.isError || capabilities.isError)
    return <p role="alert">Could not load marketing consent.</p>
  if (!consent.data || !capabilities.data)
    return <p>Loading marketing consent...</p>
  if (!consent.data.mobile)
    return <p>Save a valid mobile number to record marketing consent.</p>
  return (
    <ConsentForm
      key={`${consent.data.mobile}-${consent.data.consent?.version ?? 'unknown'}`}
      customerId={customerId}
      current={consent.data}
      timezone={capabilities.data.timezone}
    />
  )
}
function ConsentForm({
  customerId,
  current,
  timezone,
}: {
  customerId: string
  current: ConsentResponse
  timezone: string
}) {
  const mutation = useCampaignMutation<ConsentResponse>()
  const form = useForm({
    defaultValues: {
      granted: current.consent?.granted ?? false,
      source: '',
      observedAt: businessTime(new Date().toISOString(), timezone, true),
    },
    validators: {
      onSubmit: z.object({
        granted: z.boolean(),
        source: z
          .string()
          .trim()
          .min(1, 'Record how consent was obtained.')
          .max(1000),
        observedAt: z.string().min(1, 'Enter when consent was obtained.'),
      }),
    },
    onSubmit: async ({ value }) => {
      let observedAt: string
      try {
        observedAt = fromBusinessTime(value.observedAt, timezone)
      } catch (error) {
        toast.error(errorMessage(error))
        return
      }
      const pending = mutation.mutateAsync({
        path: `/customers/${customerId}/marketing-consent`,
        method: 'put',
        body: { ...value, expectedMobile: current.mobile, observedAt },
      })
      toast.promise(pending, {
        loading: 'Recording marketing consent...',
        success: 'Marketing consent recorded.',
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
        <h2 className="text-lg font-medium">WhatsApp marketing consent</h2>
        <p className="text-sm text-muted-foreground">
          For saved number {current.mobile}. Applies to every customer sharing
          this number.
        </p>
      </div>
      <p>
        {current.consent?.granted
          ? 'Opted in to promotions'
          : 'Not opted in to promotions'}
      </p>
      {current.consent && (
        <p className="text-sm text-muted-foreground">
          Last recorded: {new Date(current.consent.observedAt).toLocaleString()}{' '}
          · {current.consent.source}
        </p>
      )}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <SimpleField
          form={form}
          name="granted"
          label="Customer has explicitly agreed to WhatsApp promotions"
          type="checkbox"
        />
        <TextareaField
          form={form}
          name="source"
          label="How consent or withdrawal was obtained"
        />
        <SimpleField
          form={form}
          name="observedAt"
          label={`Consent or withdrawal obtained (${timezone})`}
          type="datetime-local"
        />
        <Button type="submit" disabled={mutation.isPending}>
          Record marketing consent
        </Button>
      </form>
    </section>
  )
}
