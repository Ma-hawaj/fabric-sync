import { useMemo } from 'react'
import { RoleGuard } from '@/components/role-guard'
import { Link } from '@tanstack/react-router'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { DownloadIcon, PrinterIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/data-table/data-table'
import { useDataTable } from '@/hooks/use-data-table'
import { useBranchDayStatus, useSalesClosing } from './hooks/use-sales-closing'
import { DailyCheckSettings } from './components/daily-check-settings'
import {
  activityLabels,
  activityTime,
  formatBhd,
  isReportDate,
  methodLabel,
  reportNotes,
  summaryRows,
  closingDayStatus,
  isClosingReadOnly,
} from './lib/sales-closing'
import {
  downloadSalesClosing,
  printSalesClosing,
} from './lib/export-sales-closing'
import { ClosingCountsForm } from './components/closing-counts'
import { OpeningCashSection } from './components/till-forms'
import { BranchExpenses } from './components/branch-expenses'
import { ClosedDayCounts } from './components/closing-comparison'
import { SkipMissedDay } from './components/missed-closing'
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import { usePreferences } from '@/features/locations/hooks/use-default-location'
import { closingBranches } from '@/features/locations/lib/location-filters'
import type { ClosingActivity, SalesClosing } from './types/sales-closing'

function ActivityTable({ report }: { report: SalesClosing }) {
  const columns = useMemo<ColumnDef<ClosingActivity>[]>(
    () => [
      {
        accessorKey: 'occurredAt',
        header: 'Time',
        cell: ({ row }) =>
          activityTime(row.original.occurredAt, report.timezone),
        size: 110,
      },
      {
        accessorKey: 'kind',
        header: 'Activity',
        cell: ({ row }) => activityLabels[row.original.kind],
        size: 240,
      },
      {
        accessorKey: 'invoiceNumber',
        header: 'Invoice',
        cell: ({ row }) => (
          <Link
            className="underline underline-offset-4"
            to="/invoices/$invoiceId"
            params={{ invoiceId: row.original.invoiceId }}
          >
            #{row.original.invoiceNumber}
          </Link>
        ),
        size: 120,
      },
      {
        accessorKey: 'method',
        header: 'Method',
        cell: ({ row }) =>
          row.original.method
            ? methodLabel(row.original.method)
            : row.original.kind === 'payment' ||
                row.original.kind === 'repair_payment'
              ? methodLabel(null)
              : '—',
        size: 160,
      },
      {
        accessorKey: 'amount',
        header: 'Amount (BHD)',
        cell: ({ row }) => formatBhd(row.original.amount),
        meta: { align: 'end' },
        size: 150,
      },
    ],
    [report.timezone],
  )
  const { table } = useDataTable({
    data: report.activity,
    columns,
    manualPagination: false,
    manualSorting: false,
    manualFiltering: false,
    getRowId: (row) => `${row.kind}-${row.id}`,
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  })
  return (
    <div className="flex h-[28rem] min-h-0 flex-col">
      <DataTable table={table} />
    </div>
  )
}

export function SalesClosingPage() {
  const [{ date, branchId }, setFilters] = useQueryStates({
    date: parseAsString.withDefault(''),
    branchId: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
  })
  const locations = useAllLocations()
  const preferences = usePreferences()
  const defaultBranch = preferences.data?.defaultLocation
  const branches = closingBranches(locations.data)
  const selectedBranch =
    branchId || (defaultBranch?.isActive ? defaultBranch.id : '')
  const valid =
    (!date || isReportDate(date)) &&
    (!selectedBranch ||
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        selectedBranch,
      ))
  const query = useSalesClosing(date, valid ? selectedBranch : '')
  const dayStatus = useBranchDayStatus(valid ? selectedBranch : '')
  const report = query.data
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Branch closing
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Check that recorded money matches the cash and payment totals at one
          branch.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <label htmlFor="closing-branch" className="block text-sm font-medium">
            Branch
          </label>
          <select
            id="closing-branch"
            value={selectedBranch}
            onChange={(event) =>
              void setFilters({ branchId: event.target.value, page: 1 })
            }
            className="h-9 min-w-52 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Choose a branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="report-date" className="block text-sm font-medium">
            Report date
          </label>
          <Input
            id="report-date"
            className="w-44"
            type="date"
            value={date || report?.date || ''}
            onChange={(event) =>
              void setFilters({ date: event.target.value, page: 1 })
            }
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void setFilters({ date: '', page: 1 })
            if (!date && selectedBranch) void query.refetch()
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          disabled={!valid || !selectedBranch || query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon className={query.isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
        <p className="ms-auto text-xs text-muted-foreground">
          {report ? `${report.timezone} · BHD` : 'BHD'}
        </p>
      </div>
      {valid && selectedBranch && (
        <DailyCheckSettings
          branchId={selectedBranch}
          status={dayStatus.data}
          loading={dayStatus.isPending}
          failed={dayStatus.isError}
        />
      )}
      {locations.isError && (
        <p role="alert">
          Could not load branches. Refresh the page to try again.
        </p>
      )}
      {!valid ? (
        <p role="alert">Choose a valid branch and report date.</p>
      ) : !selectedBranch ? (
        <p className="rounded-xl border p-8 text-center text-muted-foreground">
          Choose the branch you are closing.
        </p>
      ) : query.isError ? (
        <div role="alert" className="rounded-xl border p-6">
          Could not load the closing report. Please try Refresh.
        </div>
      ) : !report ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          Loading branch report…
        </p>
      ) : (
        <ReportContent
          key={`${report.branchId}:${report.date}`}
          report={report}
          queryDate={date}
          refreshing={query.isFetching}
          dailyCheckRequired={dayStatus.data?.dailyCheckRequired ?? true}
        />
      )}
    </div>
  )
}

function ReportContent({
  report,
  queryDate,
  refreshing,
  dailyCheckRequired,
}: {
  report: SalesClosing
  queryDate: string
  refreshing: boolean
  dailyCheckRequired: boolean
}) {
  const readOnly = isClosingReadOnly(report)
  const ready = readOnly && !refreshing
  const status = closingDayStatus(report)
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {report.branchName} · {report.date}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {status}
            {refreshing ? ' · Refreshing…' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!ready}
            onClick={() => downloadSalesClosing(report)}
          >
            <DownloadIcon />
            Export CSV
          </Button>
          <Button
            variant="outline"
            disabled={!ready}
            onClick={() =>
              toast.promise(printSalesClosing(report), {
                loading: 'Preparing the branch report...',
                success: 'Print dialog opened. Choose Save as PDF to download.',
                error: 'Could not print the report.',
              })
            }
          >
            <PrinterIcon />
            Print / Save PDF
          </Button>
        </div>
      </div>
      {report.closure ? (
        <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm">
          Closed{' '}
          {new Date(report.closure.closedAt).toLocaleString('en-GB', {
            timeZone: report.timezone,
          })}
          . This saved report is read-only and remains available for export.
          {!report.closure.comparison.matched
            ? ' Differences or unresolved activity remain recorded below.'
            : ''}
        </p>
      ) : report.missedClosing ? (
        <div role="status" className="space-y-2 rounded-xl border p-4 text-sm">
          <p>
            This day was skipped. It remains unreconciled; its saved figures
            cannot be changed.
          </p>
          <p className="whitespace-pre-wrap">{report.missedClosing.reason}</p>
          <p className="text-xs text-muted-foreground">
            Recorded{' '}
            {new Date(report.missedClosing.resolvedAt).toLocaleString('en-GB', {
              timeZone: report.timezone,
            })}{' '}
            · {report.missedClosing.resolvedBy}
          </p>
        </div>
      ) : readOnly ? (
        <p className="rounded-xl border p-4 text-sm">
          This report is read-only. Opening cash, actual counts, expenses and
          closing details cannot be added or changed for past days or history
          before tracking started.
        </p>
      ) : null}
      {report.previousUnclosedDate &&
        !report.closure &&
        !report.missedClosing && (
          <RoleGuard
            role="manager"
            fallback={
              dailyCheckRequired ? (
                <p role="alert" className="text-sm">
                  A manager must skip the missed day{' '}
                  {report.previousUnclosedDate} before trading can continue.
                </p>
              ) : null
            }
          >
            <details
              className="rounded-xl border bg-card p-5"
              id="manager-actions"
            >
              <summary className="cursor-pointer font-semibold">
                Manager actions · Skip missed day
              </summary>
              <div className="mt-4">
                <SkipMissedDay
                  key={report.previousUnclosedDate}
                  report={report}
                  disabled={refreshing}
                  required={dailyCheckRequired}
                />
              </div>
            </details>
          </RoleGuard>
        )}
      {!readOnly && (
        <p className="text-xs text-muted-foreground">
          Close the day to save actual counts and enable report exports.
        </p>
      )}
      {(report.summary.unrecordedMethodCount > 0 ||
        report.unassignedActivityCount > 0) && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          {report.summary.unrecordedMethodCount > 0 && (
            <p>
              {report.summary.unrecordedMethodCount} transactions have an
              unrecorded payment method.
            </p>
          )}
          {report.unassignedActivityCount > 0 && (
            <p>
              {report.unassignedActivityCount} payments or refunds for this day
              have no invoice branch and are excluded. Review those records
              before treating the branch totals as reconciled.
            </p>
          )}
          <p className="mt-1 font-medium">
            Closing requires an explanation for these items and will remain
            unreconciled.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {['cash', 'benefit', 'card'].map((method) => (
          <div key={method} className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground">
              Recorded net {methodLabel(method)}
            </p>
            <p className="mt-2 font-mono text-2xl">
              {formatBhd(
                report.tenders.find((t) => t.method === method)?.net ?? 0,
              )}
              <span className="ms-2 text-xs text-muted-foreground">BHD</span>
            </p>
          </div>
        ))}
      </div>
      <OpeningCashSection report={report} disabled={refreshing} />
      <BranchExpenses report={report} disabled={refreshing} />
      {readOnly ? (
        <ClosedDayCounts report={report} />
      ) : report.opening ? (
        <ClosingCountsForm
          report={report}
          queryDate={queryDate}
          disabled={refreshing || Boolean(report.previousUnclosedDate)}
        />
      ) : (
        <p className="rounded-xl border p-5 text-sm text-muted-foreground">
          Closing counts become available after opening cash has been saved.
        </p>
      )}
      <details className="rounded-xl border bg-card p-5">
        <summary className="cursor-pointer font-semibold">
          Sales and recorded receipts
        </summary>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <dl className="space-y-2 text-sm">
            {summaryRows(report).map(([label, amount], index) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">
                  {index === 0 ? amount : formatBhd(amount)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-start">Method</th>
                  <th className="text-end">Invoice</th>
                  <th className="text-end">Repair</th>
                  <th className="text-end">Refunds</th>
                  <th className="text-end">Net</th>
                </tr>
              </thead>
              <tbody>
                {report.tenders.map((t) => (
                  <tr key={t.method} className="border-b last:border-0">
                    <th className="py-3 text-start font-normal">
                      {methodLabel(t.method)}
                    </th>
                    {[
                      t.invoicePayments,
                      t.repairPayments,
                      t.refunds,
                      t.net,
                    ].map((value, index) => (
                      <td
                        key={index}
                        className="ps-3 text-end font-mono text-xs"
                      >
                        {formatBhd(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      <section className="space-y-3">
        <h2 className="font-semibold">
          Recorded branch activity{' '}
          <span className="text-sm font-normal text-muted-foreground">
            ({report.activity.length})
          </span>
        </h2>
        {report.activity.length ? (
          <ActivityTable report={report} />
        ) : (
          <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            No activity for this day.
          </p>
        )}
      </section>
      <ul className="list-disc space-y-1 ps-5 text-xs leading-relaxed text-muted-foreground">
        {reportNotes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
