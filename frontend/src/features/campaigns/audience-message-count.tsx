import { Button } from '@/components/ui/button'
import { useCampaignAudienceCount } from './hooks'
import { errorMessage } from './components'
import { audienceFromForm } from './lib/audience'
import type { AudienceFormValues } from './lib/audience'
import type { AudienceFilter } from './types'

export function AudienceMessageCount({
  values,
  excludedCustomerIds,
}: {
  values: AudienceFormValues
  excludedCustomerIds: string[]
}) {
  let filter: AudienceFilter | null = null
  let validationError: string | null = null
  try {
    filter = audienceFromForm(values, excludedCustomerIds)
  } catch (error) {
    validationError = errorMessage(error)
  }
  const count = useCampaignAudienceCount(filter)
  const updating = count.isUpdating || count.isFetching || count.isPending

  return (
    <div
      className="rounded-lg bg-muted p-4"
      role="status"
      aria-live="polite"
      aria-busy={!validationError && updating}
    >
      {validationError ? (
        <p className="text-sm">{validationError}</p>
      ) : count.isUpdating ? (
        <p className="text-sm">Updating message count…</p>
      ) : count.isError ? (
        <div className="space-y-2">
          <p className="text-sm">
            Could not calculate message count. {errorMessage(count.error)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void count.refetch()}
          >
            Retry count
          </Button>
        </div>
      ) : updating ? (
        <p className="text-sm">Updating message count…</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {count.data.messageCount.toLocaleString()} WhatsApp{' '}
            {count.data.messageCount === 1 ? 'message' : 'messages'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {count.data.matchingCustomers.toLocaleString()} matching{' '}
            {count.data.matchingCustomers === 1 ? 'customer' : 'customers'} ·{' '}
            {count.data.excludedCustomers.toLocaleString()} excluded
          </p>
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        One message per unique mobile with marketing consent. The final count is
        confirmed during approval.
      </p>
    </div>
  )
}
