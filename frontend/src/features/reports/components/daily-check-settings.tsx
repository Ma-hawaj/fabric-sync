import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { PermissionGuard } from '@/components/permission-guard'
import { Button } from '@/components/ui/button'
import { useSetDailyCheck } from '../hooks/use-sales-closing'
import type { BranchDayStatus } from '../types/sales-closing'

export function DailyCheckSettings({
  branchId,
  status,
  loading,
  failed,
}: {
  branchId: string
  status?: BranchDayStatus
  loading: boolean
  failed: boolean
}) {
  const mutation = useSetDailyCheck(branchId)
  if (failed)
    return (
      <p role="alert" className="text-sm">
        Could not load the branch's daily check setting. Refresh before changing
        it.
      </p>
    )
  if (loading || !status) return null
  const required = status.dailyCheckRequired
  async function toggle() {
    const pending = mutation.mutateAsync(!required)
    toast.promise(pending, {
      loading: 'Saving daily check setting...',
      success: !required
        ? 'Daily trading check enabled.'
        : 'Daily trading check disabled. Past active days are skipped; saved reports stay locked.',
      error: (error) =>
        error instanceof ApiError
          ? error.message
          : 'Could not confirm the change. Refresh before retrying.',
    })
    try {
      await pending
    } catch {
      return
    }
  }
  return (
    <div className="space-y-3">
      {!required && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Daily trading check is off for this branch. Opening cash and closing
          are optional for trading. Past active days are automatically skipped
          and remain unreconciled. Closed and historical reports stay locked.
        </p>
      )}
      <PermissionGuard method="PATCH" path="/sales-closing/settings">
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Branch controls · Daily trading check{' '}
            {required ? 'required' : 'off'}
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Require an opening cash amount and resolution of earlier missed
              days before new orders or payments. Disabling automatically skips
              outstanding past active days. Re-enabling skips days accumulated
              while off, then requires today's opening. Skipped days remain
              unreconciled. Closed reports stay locked.
            </p>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void toggle()}
            >
              {mutation.isPending
                ? 'Saving…'
                : required
                  ? 'Disable daily trading check'
                  : 'Enable daily trading check'}
            </Button>
          </div>
        </details>
      </PermissionGuard>
    </div>
  )
}
