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
        Choose an issuing branch to check its trading requirements.
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
  if (editing ? status.canTrade : status.canCreateOrders)
    return (
      <p className="text-xs text-muted-foreground">
        {status.dailyCheckRequired
          ? `Branch open · ${status.date} · Opening cash recorded`
          : 'Daily trading check disabled · Trading allowed'}
      </p>
    )
  const date =
    !status.closed && status.dailyCheckRequired
      ? status.previousUnclosedDate || status.date
      : status.date
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"
    >
      <p>
        {status.closed
          ? 'This branch is closed for today. New orders are blocked until the next business day.'
          : status.dailyCheckRequired && status.lateClosingDate
            ? `Close the previous active day ${status.lateClosingDate}, then save today's opening before new orders. A saved opening requires closing even with no sales.`
            : status.dailyCheckRequired && status.previousUnclosedDate
              ? `A manager must skip the missed day ${status.previousUnclosedDate} before saving new orders.`
              : status.canTrade
                ? 'This branch is inactive. New orders cannot be created here.'
                : 'Record today’s opening cash before saving new orders. The first opening starts tracking automatically.'}
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
