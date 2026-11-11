import { printHtmlDocument } from '@/lib/print-document'
import {
  activityLabels,
  activityTime,
  formatBhd,
  methodLabel,
  reportNotes,
  summaryRows,
  closingDayStatus,
  comparisonStatus,
  comparisonHeaders,
  comparisonRows,
} from './sales-closing'
import type { SalesClosing } from '../types/sales-closing'

function csvCell(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(3)
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function salesClosingCsv(report: SalesClosing): string {
  const rows: (string | number)[][] = [
    ['Branch closing report', report.date],
    ['Branch', report.branchName],
    ['Branch ID', report.branchId],
    ['Timezone', report.timezone],
    ['Generated at', report.generatedAt],
    ['Currency', 'BHD'],
    ['Day status', closingDayStatus(report)],
    ...(report.policy ? [['Controls start date', report.policy.startsOn]] : []),
    ...(report.missedClosing
      ? [
          ['Missed closing resolution ID', report.missedClosing.id],
          ['Resolution reason', report.missedClosing.reason],
          ['Resolved at', report.missedClosing.resolvedAt],
          ['Resolved by', report.missedClosing.resolvedBy],
          ['Reconciliation status', 'Unreconciled — past figures unchanged'],
        ]
      : []),
    ...(report.closure
      ? [
          ['Closure ID', report.closure.id],
          ['Closed at', report.closure.closedAt],
          ['Closed by', report.closure.closedBy],
        ]
      : []),
    ['Closing count status', comparisonStatus(report)],
    ['Unassigned activities excluded', report.unassignedActivityCount],
    ...(report.opening
      ? [
          ['Saved opening cash', report.opening.amount],
          ['Opening recorded at', report.opening.recordedAt],
          ['Opening notes', report.opening.notes],
        ]
      : []),
    ...(report.closure
      ? [
          ['Opening cash', report.closure.counts.openingCash],
          ['Other cash added', report.closure.counts.cashAdded],
          ['Cash removed / banked', report.closure.counts.cashRemoved],
          ['Closing notes', report.closure.counts.notes],
          comparisonHeaders,
          ...comparisonRows(report.closure.comparison).map((row) =>
            row.map((value) => value ?? ''),
          ),
        ]
      : []),
    [],
    ['Summary', 'Value'],
    ...summaryRows(report),
    [],
    [
      'Method',
      'Invoice payments',
      'Repair payments',
      'Refunds paid',
      'Net external receipts',
    ],
    ...report.tenders.map((tender) => [
      methodLabel(tender.method),
      tender.invoicePayments,
      tender.repairPayments,
      tender.refunds,
      tender.net,
    ]),
    [],
    [
      'Paid expense',
      'Payment method',
      'Amount (BHD)',
      'Paid to',
      'Receipt / reference',
      'Recorded at',
      'Status',
      'Void reason',
    ],
    ...report.expenses.map((expense) => [
      expense.reason,
      methodLabel(expense.paymentType),
      expense.amount,
      expense.paidTo,
      expense.reference,
      expense.recordedAt,
      expense.voidedAt ? 'Voided' : 'Paid',
      expense.voidReason ?? '',
    ]),
    [],
    ['Time', 'Activity', 'Invoice', 'Method', 'Amount (BHD)', 'Record ID'],
    ...report.activity.map((event) => [
      activityTime(event.occurredAt, report.timezone),
      activityLabels[event.kind],
      String(event.invoiceNumber),
      event.method
        ? methodLabel(event.method)
        : event.kind === 'payment' || event.kind === 'repair_payment'
          ? methodLabel(null)
          : '',
      event.amount,
      event.id,
    ]),
    [],
    ...reportNotes.map((note) => [note]),
  ]
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadSalesClosing(report: SalesClosing): void {
  const url = URL.createObjectURL(
    new Blob([salesClosingCsv(report)], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `branch-closing-${report.branchId}-${report.date}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  )
}

export function salesClosingHtml(report: SalesClosing): string {
  const cells = (values: string[]) =>
    `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sales closing ${escapeHtml(report.date)}</title>
    <style>@page{size:A4;margin:15mm}body{font:12px system-ui,sans-serif;color:#172b25}h1{font-size:24px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}th{background:#f1f4f2}td:last-child{text-align:right;font-variant-numeric:tabular-nums}tr{break-inside:avoid}thead{display:table-header-group}p,li{line-height:1.5}.notes{font-size:10px;color:#555}</style></head><body>
    <h1>Branch closing report</h1><p>${escapeHtml(report.branchName)} · ${escapeHtml(report.date)} · ${escapeHtml(report.timezone)} · BHD<br>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: report.timezone }))}</p>
    <p>${escapeHtml(closingDayStatus(report))}${report.closure ? ` · ${escapeHtml(report.closure.closedAt)} · By ${escapeHtml(report.closure.closedBy)} · Reference ${escapeHtml(report.closure.id)}` : ''}</p>
    ${report.policy ? `<p>Closing controls start: ${escapeHtml(report.policy.startsOn)}</p>` : ''}
    ${report.missedClosing ? `<p>Missed closing resolved separately — unreconciled. Figures unchanged.<br>Reason: ${escapeHtml(report.missedClosing.reason)}<br>Resolved ${escapeHtml(report.missedClosing.resolvedAt)} · By ${escapeHtml(report.missedClosing.resolvedBy)} · Reference ${escapeHtml(report.missedClosing.id)}</p>` : ''}
    <p>Closing count status: ${escapeHtml(comparisonStatus(report))}. Unassigned activities excluded: ${report.unassignedActivityCount}.</p>
    ${report.opening ? `<p>Saved opening cash: ${formatBhd(report.opening.amount)} BHD · Recorded ${escapeHtml(new Date(report.opening.recordedAt).toLocaleString('en-GB', { timeZone: report.timezone }))}${report.opening.supersedesId ? ' · Corrected opening' : ''}<br>Opening notes: ${escapeHtml(report.opening.notes)}</p>` : ''}
    ${
      report.closure
        ? `<h2>Recorded vs actual — saved closing count</h2><table><thead><tr>${comparisonHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${comparisonRows(
            report.closure.comparison,
          )
            .map(([method, ...amounts]) =>
              cells([
                method,
                ...amounts.map((value) =>
                  value === null ? '—' : formatBhd(value),
                ),
              ]),
            )
            .join(
              '',
            )}</tbody></table><p>Opening cash: ${formatBhd(report.closure.counts.openingCash)} · Other cash added: ${formatBhd(report.closure.counts.cashAdded)} · Cash removed / banked: ${formatBhd(report.closure.counts.cashRemoved)}</p><p>Notes: ${escapeHtml(report.closure.counts.notes)}</p>`
        : ''
    }
    <h2>Daily summary</h2><table><tbody>${summaryRows(report)
      .map(([label, amount], index) =>
        cells([label, index === 0 ? String(amount) : formatBhd(amount)]),
      )
      .join('')}</tbody></table>
    <h2>External receipts by method</h2><table><thead><tr><th>Method</th><th>Invoice</th><th>Repair</th><th>Refunds</th><th>Net</th></tr></thead><tbody>${report.tenders.map((t) => cells([methodLabel(t.method), formatBhd(t.invoicePayments), formatBhd(t.repairPayments), formatBhd(t.refunds), formatBhd(t.net)])).join('')}</tbody></table>
    <h2>Paid expenses</h2><table><thead><tr><th>Reason</th><th>Paid by</th><th>Payee / reference</th><th>Status</th><th>BHD</th></tr></thead><tbody>${report.expenses.map((expense) => cells([expense.reason, methodLabel(expense.paymentType), [expense.paidTo, expense.reference].filter(Boolean).join(' · ') || '—', expense.voidedAt ? `Voided: ${expense.voidReason}` : 'Paid', formatBhd(expense.amount)])).join('') || '<tr><td colspan="5">No expenses recorded for this day.</td></tr>'}</tbody></table>
    <h2>Activity (${report.activity.length})</h2><table><thead><tr><th>Time</th><th>Activity</th><th>Invoice</th><th>Method</th><th>BHD</th></tr></thead><tbody>${report.activity.map((e) => cells([activityTime(e.occurredAt, report.timezone), activityLabels[e.kind], String(e.invoiceNumber), e.method ? methodLabel(e.method) : e.kind === 'payment' || e.kind === 'repair_payment' ? methodLabel(null) : '—', formatBhd(e.amount)])).join('') || '<tr><td colspan="5">No activity for this day.</td></tr>'}</tbody></table>
    <ul class="notes">${reportNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></body></html>`
}

export async function printSalesClosing(report: SalesClosing): Promise<void> {
  await printHtmlDocument(salesClosingHtml(report), 'sales closing report')
}
