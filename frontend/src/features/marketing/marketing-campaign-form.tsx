import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { TextareaField } from '@/components/form/fields'
import { useDataTable } from '@/hooks/use-data-table'
import { useCustomers } from '@/features/customers/hooks/use-customers'
import { ApiError } from '@/lib/api'
import type { Customer } from '@/features/customers/types/customers'
import { recipientColumns } from './components/campaign-recipient-columns'
import { useCreateCampaign } from './hooks/use-create-campaign'
import {
  defaultRecipientSelection,
  optedInCustomers,
} from './lib/recipient-selection'
import { marketingCampaignFormSchema } from './lib/marketing-campaign-schema'
import { createEmptyCampaignForm } from './types/campaign-form'

export function MarketingCampaignFormPage() {
  const { data: customers = [], isLoading } = useCustomers()

  if (isLoading) {
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        Loading customers...
      </div>
    )
  }

  return <MarketingCampaignForm recipients={optedInCustomers(customers)} />
}

function MarketingCampaignForm({ recipients }: { recipients: Customer[] }) {
  const navigate = useNavigate()
  const createCampaign = useCreateCampaign()

  const { table } = useDataTable({
    data: recipients,
    columns: recipientColumns,
    manualFiltering: false,
    manualSorting: false,
    manualPagination: false,
    getRowId: (customer) => customer.id,
    initialState: {
      rowSelection: defaultRecipientSelection(recipients),
      pagination: { pageIndex: 0, pageSize: Math.max(recipients.length, 10) },
    },
  })

  const form = useForm({
    defaultValues: createEmptyCampaignForm(),
    validators: { onSubmit: marketingCampaignFormSchema },
    onSubmit: async ({ value }) => {
      const recipientCustomerIds = table
        .getFilteredSelectedRowModel()
        .rows.map((row) => row.original.id)

      if (recipientCustomerIds.length === 0) {
        toast.error('Select at least one recipient.')
        return
      }

      const pending = createCampaign.mutateAsync({
        body: value.body,
        recipientCustomerIds,
      })

      toast.promise(pending, {
        loading: 'Sending message...',
        success: (campaign) => {
          const sent = campaign.recipients.filter(
            (recipient) => recipient.status === 'sent',
          ).length
          return `Sent to ${sent} of ${campaign.recipients.length} recipients.`
        },
        error: (error) =>
          error instanceof ApiError
            ? error.message
            : 'Could not send this message. Please try again.',
      })

      try {
        await pending
      } catch {
        return
      }
      await navigate({ to: '/marketing' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Message</h1>
        <p className="text-muted-foreground">
          Send a WhatsApp message to customers who opted in to marketing
          messages. Everyone opted in is selected by default — deselect anyone
          you don't want to include.
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
          <TextareaField form={form} name="body" label="Message" rows={5} />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Recipients</h2>
          {recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No customers have opted in to marketing messages yet.
            </p>
          ) : (
            <DataTable table={table}>
              <DataTableToolbar table={table} />
            </DataTable>
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
            onClick={() => navigate({ to: '/marketing' })}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createCampaign.isPending || recipients.length === 0}
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
