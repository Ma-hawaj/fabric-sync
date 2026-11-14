import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { defineColumns } from '@/lib/define-columns'
import { useDataTable } from '@/hooks/use-data-table'
import { DataTable } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { PermissionGuard } from '@/components/permission-guard'
import { TextField, TextareaField } from '@/components/form/fields'
import {
  useCampaignCapabilities,
  useCampaignMutation,
  useMarketingTemplates,
} from './hooks'
import {
  AssetUpload,
  SimpleField,
  StateBadge,
  errorMessage,
} from './components'
import type { MarketingTemplate } from './types'

export function MarketingTemplatesPage() {
  const query = useMarketingTemplates()
  const capabilities = useCampaignCapabilities()
  const mutation = useCampaignMutation<MarketingTemplate>()
  const [formState, setFormState] = useState<{
    existing?: MarketingTemplate
    copy?: MarketingTemplate
  } | null>(null)
  const columns = defineColumns<MarketingTemplate>()([
    {
      accessorKey: 'name',
      header: 'Template',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.name}</span>
          {row.original.archived && (
            <p className="text-xs text-muted-foreground">Archived</p>
          )}
        </div>
      ),
    },
    { accessorKey: 'language', header: 'Language' },
    {
      accessorKey: 'state',
      header: 'Approval',
      cell: ({ row }) => (
        <div className="space-y-1">
          <StateBadge state={row.original.state} />
          {row.original.rejectionReason && (
            <p className="max-w-sm whitespace-normal text-xs text-muted-foreground">
              {row.original.rejectionReason}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const template = row.original
        return (
          <div className="flex flex-wrap gap-2">
            {template.state === 'draft' && !template.archived ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFormState({ existing: template })}
                >
                  Edit
                </Button>
                <PermissionGuard
                  method="POST"
                  path="/campaign-templates/:id/submit"
                >
                  <Button
                    size="sm"
                    disabled={
                      mutation.isPending ||
                      !capabilities.data?.canManageTemplates
                    }
                    onClick={() => {
                      const pending = mutation.mutateAsync({
                        path: `/campaign-templates/${template.id}/submit`,
                      })
                      void pending.catch(() => undefined)
                      toast.promise(pending, {
                        loading: 'Submitting template to Meta...',
                        success:
                          'Template submitted. Meta approval is required before sending.',
                        error: errorMessage,
                      })
                    }}
                  >
                    Submit to Meta
                  </Button>
                </PermissionGuard>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFormState({ copy: template })}
              >
                New version
              </Button>
            )}
            {!template.archived && (
              <PermissionGuard
                method="POST"
                path="/campaign-templates/:id/archive"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const pending = mutation.mutateAsync({
                      path: `/campaign-templates/${template.id}/archive`,
                    })
                    void pending.catch(() => undefined)
                    toast.promise(pending, {
                      loading: 'Archiving template...',
                      success: 'Template archived locally.',
                      error: errorMessage,
                    })
                  }}
                >
                  Archive
                </Button>
              </PermissionGuard>
            )}
          </div>
        )
      },
    },
  ])
  const { table } = useDataTable({
    columns,
    data: query.data ?? [],
    manualPagination: false,
    manualFiltering: false,
    manualSorting: false,
  })
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-info" to="/campaigns">
            Campaigns
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Marketing templates</h1>
          <p className="text-sm text-muted-foreground">
            Create language variants and track approval from Meta.
          </p>
        </div>
        <div className="flex gap-2">
          <PermissionGuard method="POST" path="/campaign-templates/sync">
            <Button
              variant="outline"
              disabled={
                mutation.isPending || !capabilities.data?.canManageTemplates
              }
              onClick={() => {
                const pending = mutation.mutateAsync({
                  path: '/campaign-templates/sync',
                })
                void pending.catch(() => undefined)
                toast.promise(pending, {
                  loading: 'Synchronizing with Meta...',
                  success: 'Template statuses synchronized.',
                  error: errorMessage,
                })
              }}
            >
              Sync with Meta
            </Button>
          </PermissionGuard>
          <Button onClick={() => setFormState({})}>New template</Button>
        </div>
      </div>
      {capabilities.data && !capabilities.data.canManageTemplates && (
        <p className="rounded-lg border p-4 text-sm">
          Meta template management is not configured. You can prepare drafts
          now.
        </p>
      )}
      {query.isError && <p role="alert">Could not load marketing templates.</p>}
      {formState && (
        <TemplateForm
          key={`${formState.existing?.id ?? formState.copy?.id ?? 'new'}-${formState.existing?.revision ?? 'copy'}`}
          existing={formState.existing}
          copy={formState.copy}
          onClose={() => setFormState(null)}
        />
      )}
      <div className="min-h-80">
        <DataTable
          table={table}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
        />
      </div>
    </div>
  )
}
function TemplateForm({
  existing,
  copy,
  onClose,
}: {
  existing?: MarketingTemplate
  copy?: MarketingTemplate
  onClose: () => void
}) {
  const mutation = useCampaignMutation<MarketingTemplate>()
  const initial = existing ?? copy
  const d = initial?.definition
  const form = useForm({
    defaultValues: {
      name: existing?.name ?? (copy ? `${copy.name}_copy` : ''),
      language: initial?.language ?? 'en_US',
      body: d?.body ?? '',
      examples: d?.examples.join('\n') ?? '',
      footer: d?.footer ?? '',
      imageHeader: d?.imageHeader ?? false,
      sampleAssetId: d?.sampleAssetId ?? (null as string | null),
      websiteLabel: d?.websiteLabel ?? '',
      websiteUrl: d?.websiteUrl ?? '',
      unsubscribeLabel: d?.unsubscribeLabel ?? 'Unsubscribe',
    },
    validators: {
      onSubmit: z.object({
        name: z
          .string()
          .regex(
            /^[a-z0-9_]+$/,
            'Use lowercase letters, numbers and underscores.',
          ),
        language: z.string().min(1, 'Enter a language code.'),
        body: z.string().trim().min(1, 'Enter the message body.').max(1024),
        examples: z.string(),
        footer: z.string(),
        imageHeader: z.boolean(),
        sampleAssetId: z.string().nullable(),
        websiteLabel: z.string(),
        websiteUrl: z.string(),
        unsubscribeLabel: z
          .string()
          .trim()
          .min(1, 'Enter an unsubscribe label.')
          .max(25),
      }),
    },
    onSubmit: async ({ value }) => {
      const pending = mutation.mutateAsync({
        path: existing
          ? `/campaign-templates/${existing.id}`
          : '/campaign-templates',
        method: existing ? 'patch' : 'post',
        body: {
          name: value.name,
          language: value.language,
          expectedRevision: existing?.revision,
          definition: {
            body: value.body,
            examples: value.examples ? value.examples.split(/\r?\n/) : [],
            footer: value.footer || null,
            imageHeader: value.imageHeader,
            sampleAssetId: value.imageHeader ? value.sampleAssetId : null,
            websiteLabel: value.websiteLabel || null,
            websiteUrl: value.websiteUrl || null,
            unsubscribeLabel: value.unsubscribeLabel,
          },
        },
      })
      void pending.catch(() => undefined)
      toast.promise(pending, {
        loading: 'Saving template draft...',
        success: 'Template draft saved.',
        error: errorMessage,
      })
      try {
        await pending
      } catch {
        return
      }
      onClose()
    },
  })
  return (
    <section className="max-w-3xl space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-medium">
        {existing
          ? 'Edit template draft'
          : copy
            ? 'New template version'
            : 'New template draft'}
      </h2>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField form={form} name="name" label="Template name" />
          <SimpleField
            form={form}
            name="language"
            label="Language"
            options={[
              { value: 'en_US', label: 'English (en_US)' },
              { value: 'ar', label: 'Arabic (ar)' },
              ...(!['en_US', 'ar'].includes(initial?.language ?? '') &&
              initial?.language
                ? [{ value: initial.language, label: initial.language }]
                : []),
            ]}
          />
        </div>
        <TextareaField form={form} name="body" label="Message body" />
        <p className="text-xs text-muted-foreground">
          Use numbered fields such as {'{{1}}'} and {'{{2}}'} for offer details.
          A single approved body may contain English and Arabic.
        </p>
        <TextareaField
          form={form}
          name="examples"
          label="Example field values for Meta (one per line, in order)"
        />
        <TextField form={form} name="footer" label="Footer (optional)" />
        <SimpleField
          form={form}
          name="imageHeader"
          label="Include a promotional image header"
          type="checkbox"
        />
        <form.Subscribe selector={(state) => state.values.imageHeader}>
          {(enabled) =>
            enabled ? (
              <form.Field name="sampleAssetId">
                {(field) => (
                  <AssetUpload
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name="websiteLabel"
            label="Website button label (optional)"
          />
          <TextField
            form={form}
            name="websiteUrl"
            label="Website button HTTPS URL (optional)"
          />
        </div>
        <TextField
          form={form}
          name="unsubscribeLabel"
          label="Unsubscribe button label"
        />
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
        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            Save template draft
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </section>
  )
}
