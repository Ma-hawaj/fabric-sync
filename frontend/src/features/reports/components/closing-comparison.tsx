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
  const closing = report.closure
  if (!closing)
    return (
      <p className="rounded-xl border bg-card p-5 text-sm">
        No actual closing count was recorded. Recorded transactions remain
        available for viewing and export.
      </p>
    )
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Final closing count</h2>
      <CountsComparison comparison={closing.comparison} />
      <p className="text-sm">
        Other cash added: BHD {formatBhd(closing.counts.cashAdded)} · Cash
        banked / transferred out: BHD {formatBhd(closing.counts.cashRemoved)}
      </p>
      {closing.counts.notes && (
        <p className="whitespace-pre-wrap text-sm">{closing.counts.notes}</p>
      )}
    </section>
  )
}
