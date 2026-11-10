import { useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useCloseDay } from '../hooks/use-sales-closing'
import { formatBhd, methodLabel, isClosingReadOnly } from '../lib/sales-closing'
import type { SalesClosing } from '../types/sales-closing'

export function CloseDay({
  report,
  queryDate,
  ready,
}: {
  report: SalesClosing
  queryDate: string
  ready: boolean
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const mutation = useCloseDay(queryDate, report.branchId)
  const check = report.lastCheck
  if (
    isClosingReadOnly(report) ||
    (report.businessDate && report.date > report.businessDate)
  )
    return null
  const needsExplanation =
    check && !check.comparison.matched && !check.counts.notes.trim()
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">4. Close branch day</h2>
      <p className="text-sm text-muted-foreground">
        Final closing locks this report, opening cash and expenses. New orders
        and payments for this branch will be blocked until the next business
        day. Explained shortages or overages stay in the saved report.
      </p>
      {report.previousUnclosedDate ? (
        <p role="alert" className="text-sm">
          A manager must resolve the missed closing for{' '}
          {report.previousUnclosedDate} first.
        </p>
      ) : (
        <>
          {!ready && (
            <p className="text-sm text-muted-foreground">
              Save a current branch check before closing.
            </p>
          )}
          {needsExplanation && (
            <p role="alert" className="text-sm text-destructive">
              Add a closing note explaining the unresolved activity, then save
              the check again.
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              disabled={!ready || mutation.isPending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I have finished recording this branch’s activity for {report.date}.
            I understand the report will be read-only.
          </label>
          <Button
            disabled={
              !ready ||
              !confirmed ||
              Boolean(needsExplanation) ||
              mutation.isPending
            }
            onClick={() => {
              if (!check) return
              const pending = mutation.mutateAsync({
                requestId,
                branchId: report.branchId,
                date: report.date,
                checkId: check.id,
                fingerprint: report.fingerprint,
              })
              toast.promise(pending, {
                loading: 'Closing branch day...',
                success: 'Branch day closed. The report is now read-only.',
                error: (error) =>
                  error instanceof ApiError
                    ? error.message
                    : 'Could not confirm closing. Refresh the report before retrying.',
              })
            }}
          >
            {mutation.isPending ? 'Closing…' : 'Close branch day'}
          </Button>
        </>
      )}
    </section>
  )
}

export function ClosedDayCounts({ report }: { report: SalesClosing }) {
  const check = report.lastCheck
  if (!check)
    return (
      <p className="rounded-xl border bg-card p-5 text-sm">
        No actual closing count was recorded. Recorded transactions remain
        available for viewing and export.
      </p>
    )
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">
        {report.closure
          ? 'Final closing count'
          : 'Last saved count · Read-only'}
      </h2>
      {check.fingerprint !== report.fingerprint && (
        <p className="text-sm">
          Activity changed after this saved count. These comparison values are
          from the saved check; this day is unreconciled.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">Method</th>
              <th className="p-3 text-end">Expected (BHD)</th>
              <th className="p-3 text-end">Actual (BHD)</th>
              <th className="p-3 text-end">Over / short (BHD)</th>
            </tr>
          </thead>
          <tbody>
            {check.comparison.lines.map((line) => (
              <tr key={line.method} className="border-b last:border-0">
                <th className="p-3 text-start font-medium">
                  {methodLabel(line.method)}
                </th>
                <td className="p-3 text-end font-mono">
                  {formatBhd(line.expected)}
                </td>
                <td className="p-3 text-end font-mono">
                  {formatBhd(line.actual)}
                </td>
                <td
                  className={`p-3 text-end font-mono ${line.difference ? 'text-destructive' : ''}`}
                >
                  {formatBhd(line.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        Other cash added: BHD {formatBhd(check.counts.cashAdded)} · Cash banked
        / transferred out: BHD {formatBhd(check.counts.cashRemoved)}
      </p>
      {check.counts.notes && (
        <p className="whitespace-pre-wrap text-sm">{check.counts.notes}</p>
      )}
    </section>
  )
}
