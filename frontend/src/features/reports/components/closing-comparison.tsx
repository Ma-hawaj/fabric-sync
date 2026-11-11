import {
  comparisonHeaders,
  comparisonRows,
  formatBhd,
} from '../lib/sales-closing'
import type { ClosingComparison, SalesClosing } from '../types/sales-closing'

export function CountsComparison({
  comparison,
}: {
  comparison?: ClosingComparison
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {comparisonHeaders.map((header, index) => (
              <th
                key={header}
                className={`p-3 ${index ? 'text-end' : 'text-start'}`}
              >
                {header}
                {index ? ' (BHD)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparisonRows(comparison).map(([method, ...amounts]) => (
            <tr key={method} className="border-b last:border-0">
              <th className="p-3 text-start font-medium">{method}</th>
              {amounts.map((value, index) => (
                <td
                  key={index}
                  className={`p-3 text-end font-mono ${index === 3 && value ? 'text-destructive' : ''}`}
                >
                  {value === null ? '—' : formatBhd(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <CountsComparison comparison={check.comparison} />
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
