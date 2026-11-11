import type { BranchDayStatus } from '../types/sales-closing'

export function BranchDayNotice({
  status,
  branchId,
  loading,
  failed,
  editing = false,
}: {
  status?: BranchDayStatus
  branchId: string
  loading: boolean
  failed: boolean
  editing?: boolean
}) {
  if (!branchId)
    return (
      <p className="text-sm text-muted-foreground">
        Choose an issuing branch. Opening cash is required before saving orders.
      </p>
    )
  if (failed)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not check whether this branch is open. Refresh before saving.
      </p>
    )
  if (loading || !status)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking branch day…
      </p>
    )
  if (status.setupRequired)
    return (
      <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
        <p>A manager must set this branch’s go-live date before trading.</p>
        <a
          className="underline"
          href={`/sales-closing?branchId=${encodeURIComponent(branchId)}`}
        >
          Set up branch closing
        </a>
      </div>
    )
  if (status.controlsStartDate && status.date < status.controlsStartDate)
    return (
      <p className="text-xs text-muted-foreground">
        Closing controls start {status.controlsStartDate}. Opening cash will be
        required from that date.
      </p>
    )
  if (editing ? status.canTrade : status.canCreateOrders)
    return (
      <p className="text-xs text-muted-foreground">
        Branch open · {status.date} · Opening cash recorded
      </p>
    )
  const date = status.previousUnclosedDate || status.date
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"
    >
      <p>
        {status.previousUnclosedDate
          ? `A manager must resolve the missed closing for ${status.previousUnclosedDate} before saving new orders.`
          : status.closed
            ? 'This branch is closed for today. New orders are blocked until the next business day.'
            : status.canTrade
              ? 'This branch is inactive. New orders cannot be created here.'
              : 'Record today’s opening cash for this branch before saving new orders.'}
      </p>
      <a
        className="underline underline-offset-4"
        href={`/sales-closing?branchId=${encodeURIComponent(branchId)}&date=${date}`}
      >
        Open branch closing
      </a>
    </div>
  )
}
