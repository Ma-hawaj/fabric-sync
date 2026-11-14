import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import {
  useCampaignCapabilities,
  useCampaignMutation,
  useMarketingTemplates,
} from './hooks'
import { AssetUpload, SimpleField, errorMessage } from './components'
import { businessTime, fromBusinessTime } from './lib/business-time'
import { audienceFromForm } from './lib/audience'
import { AudienceMessageCount } from './audience-message-count'
import type { Campaign, CampaignInput, MarketingTemplate } from './types'

export function CampaignFormPage({
  existing,
  onSaved,
}: {
  existing?: Campaign
  onSaved?: () => void
}) {
  const templates = useMarketingTemplates()
  const capabilities = useCampaignCapabilities()
  if (templates.isError || capabilities.isError)
    return <p role="alert">Could not load campaign settings.</p>
  if (!templates.data || !capabilities.data)
    return <p>Loading campaign settings...</p>
  return (
    <CampaignForm
      key={existing?.revision ?? 'new'}
      existing={existing}
      templates={templates.data}
      timezone={capabilities.data.timezone}
      onSaved={onSaved}
    />
  )
}
function CampaignForm({
  existing,
  templates,
  timezone,
  onSaved,
}: {
  existing?: Campaign
  templates: MarketingTemplate[]
  timezone: string
  onSaved?: () => void
}) {
  const navigate = useNavigate()
  const mutation = useCampaignMutation()
  const locations = useAllLocations()
  const initial = existing?.definition
  const filter = initial?.audience
  const form = useForm({
    defaultValues: {
      name: initial?.name ?? '',
      templateId: initial?.templateId ?? '',
      parameters: initial?.parameters ?? ([] as string[]),
      assetId: initial?.assetId ?? (null as string | null),
      sendAt: initial?.sendAt ? businessTime(initial.sendAt, timezone) : '',
      expiresAt: initial ? businessTime(initial.expiresAt, timezone) : '',
      lastPurchaseFrom: filter?.lastPurchaseFrom ?? '',
      lastPurchaseTo: filter?.lastPurchaseTo ?? '',
      neverPurchased: filter?.neverPurchased ?? false,
      minPurchases: filter?.minPurchases?.toString() ?? '',
      maxPurchases: filter?.maxPurchases?.toString() ?? '',
      minSpend: filter?.minSpend ?? '',
      maxSpend: filter?.maxSpend ?? '',
      branchId: filter?.branchId ?? '',
    },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, 'Enter a campaign name.').max(200),
        templateId: z.string().min(1, 'Choose an approved template.'),
        parameters: z.array(z.string().trim().min(1, 'Enter a message value.')),
        expiresAt: z.string().min(1, 'Enter a sending deadline.'),
        assetId: z.string().nullable(),
        sendAt: z.string(),
        lastPurchaseFrom: z.string(),
        lastPurchaseTo: z.string(),
        neverPurchased: z.boolean(),
        minPurchases: z.string(),
        maxPurchases: z.string(),
        minSpend: z.string(),
        maxSpend: z.string(),
        branchId: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      let body: CampaignInput
      try {
        body = {
          name: value.name,
          templateId: value.templateId,
          parameters: value.parameters,
          assetId: value.assetId,
          sendAt: value.sendAt
            ? fromBusinessTime(value.sendAt, timezone)
            : null,
          expiresAt: fromBusinessTime(value.expiresAt, timezone),
          expectedRevision: existing?.revision,
          audience: audienceFromForm(value, filter?.excludedCustomerIds),
        }
      } catch (error) {
        toast.error(errorMessage(error))
        return
      }
      const pending = mutation.mutateAsync({
        path: existing ? `/campaigns/${existing.id}` : '/campaigns',
        method: existing ? 'patch' : 'post',
        body,
      })
      toast.promise(pending, {
        loading: 'Saving campaign draft...',
        success: 'Campaign draft saved.',
        error: errorMessage,
      })
      let saved: Campaign
      try {
        saved = await pending
      } catch {
        return
      }
      onSaved?.()
      await navigate({
        to: '/campaigns/$campaignId',
        params: { campaignId: saved.id },
      })
    },
  })
  const eligible = templates.filter(
    (t) => t.state === 'approved' && !t.archived,
  )
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {existing ? 'Edit campaign draft' : 'New campaign'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Save the draft, then review the message and audience before manager
          approval.
        </p>
      </div>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Message</h2>
          <TextField form={form} name="name" label="Campaign name" />
          <form.Field name="templateId">
            {(field) => (
              <label className="block text-sm font-medium">
                Approved marketing template
                <select
                  className="mt-2 h-9 w-full rounded-md border bg-background px-3"
                  value={field.state.value}
                  onChange={(event) => {
                    const selected = templates.find(
                      (t) => t.id === event.target.value,
                    )
                    field.handleChange(event.target.value)
                    const count = Math.max(
                      0,
                      ...[
                        ...(selected?.definition.body ?? '').matchAll(
                          /\{\{(\d+)\}\}/g,
                        ),
                      ].map((match) => Number(match[1])),
                    )
                    form.setFieldValue(
                      'parameters',
                      Array.from({ length: count }, () => ''),
                    )
                    if (!selected?.definition.imageHeader)
                      form.setFieldValue('assetId', null)
                  }}
                >
                  <option value="">Select a template</option>
                  {eligible.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </option>
                  ))}
                </select>
                {field.state.meta.errors.length > 0 && (
                  <span className="text-destructive">
                    Choose an approved template.
                  </span>
                )}
              </label>
            )}
          </form.Field>
          {!eligible.length && (
            <p>
              No approved marketing templates yet. Create and submit one in
              Marketing templates.
            </p>
          )}
          <form.Subscribe
            selector={(state) =>
              [state.values.templateId, state.values.parameters.length] as const
            }
          >
            {([id, count]) => {
              const template = templates.find((t) => t.id === id)
              return (
                <>
                  <p
                    className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm"
                    dir="auto"
                  >
                    {template?.definition.body}
                  </p>
                  {Array.from({ length: count }, (_, index) => (
                    <TextField
                      key={index}
                      form={form}
                      name={`parameters[${index}]`}
                      label={`Message value ${index + 1}`}
                    />
                  ))}
                  {template?.definition.imageHeader && (
                    <form.Field name="assetId">
                      {(field) => (
                        <AssetUpload
                          value={field.state.value}
                          onChange={field.handleChange}
                        />
                      )}
                    </form.Field>
                  )}
                </>
              )
            }}
          </form.Subscribe>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Audience</h2>
          <p className="text-sm text-muted-foreground">
            All filters apply together. Only customers with current marketing
            consent can receive a promotion. Leave filters empty to include all
            eligible customers.
          </p>
          <SimpleField
            form={form}
            name="neverPurchased"
            label="Customers who have never purchased"
            type="checkbox"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleField
              form={form}
              name="lastPurchaseFrom"
              label="Last purchase on or after"
              type="date"
            />
            <SimpleField
              form={form}
              name="lastPurchaseTo"
              label="Last purchase on or before"
              type="date"
            />
            <SimpleField
              form={form}
              name="minPurchases"
              label="Minimum purchase count"
              type="number"
            />
            <SimpleField
              form={form}
              name="maxPurchases"
              label="Maximum purchase count"
              type="number"
            />
            <TextField
              form={form}
              name="minSpend"
              label="Minimum lifetime purchase value (BHD)"
            />
            <TextField
              form={form}
              name="maxSpend"
              label="Maximum lifetime purchase value (BHD)"
            />
          </div>
          <SimpleField
            form={form}
            name="branchId"
            label="Has purchased at issuing branch"
            options={[
              { value: '', label: 'Any branch' },
              ...locations.data.map((location) => ({
                value: location.id,
                label: location.name,
              })),
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Purchase counts and values cover distinct associated invoices after
            credits. Shared invoices count once for each associated customer.
            Branch selection does not narrow the lifetime totals.
          </p>
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <AudienceMessageCount
                values={values}
                excludedCustomerIds={filter?.excludedCustomerIds ?? []}
              />
            )}
          </form.Subscribe>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Sending time</h2>
          <p className="text-sm text-muted-foreground">
            All times below use {timezone}. Sending starts at the selected time
            and stops at the deadline.
          </p>
          <SimpleField
            form={form}
            name="sendAt"
            label="Scheduled start (leave empty to send on approval)"
            type="datetime-local"
          />
          <SimpleField
            form={form}
            name="expiresAt"
            label="Final sending deadline"
            type="datetime-local"
          />
        </section>
        <form.Subscribe
          selector={(state) =>
            [state.submissionAttempts, state.isValid] as const
          }
        >
          {([attempts, valid]) =>
            attempts > 0 && !valid ? (
              <p role="alert" className="text-destructive">
                Fix the highlighted fields before saving.
              </p>
            ) : null
          }
        </form.Subscribe>
        <Button type="submit" disabled={mutation.isPending}>
          Save draft
        </Button>
      </form>
    </div>
  )
}
