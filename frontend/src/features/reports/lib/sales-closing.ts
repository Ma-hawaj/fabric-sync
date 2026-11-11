import { parseFilterDate } from '@/lib/filter-date'
import type {
  ClosingActivity,
  ClosingComparison,
  SalesClosing,
} from '../types/sales-closing'

export function isClosingReadOnly(report: SalesClosing): boolean {
  return report.readOnly
}

export function closingDayStatus(report: SalesClosing): string {
  if (report.closure) return 'Closed · Read-only'
  if (report.missedClosing)
    return 'Missed closing resolved · Unreconciled · Read-only'
  if (isClosingReadOnly(report) && !report.policy)
    return 'Setup required · Read-only'
  if (report.policy && report.date < report.policy.startsOn)
    return 'Before go-live · Read-only'
  if (report.businessDate && report.date > report.businessDate)
    return 'Future report · Read-only'
  if (isClosingReadOnly(report)) return 'Historical report · Read-only'
  return 'Open · Closing count not finalized'
}

export function comparisonStatus(report: SalesClosing): string {
  if (!report.lastCheck) return 'No closing count recorded'
  if (report.lastCheck.fingerprint !== report.fingerprint)
    return 'Recorded activity changed'
  return report.lastCheck.comparison.matched
    ? 'Matched'
    : 'Differences / review required'
}

export const comparisonHeaders = [
  'Method',
  'Recorded net',
  'Expected',
  'Actual',
  'Over / short',
]

export function comparisonRows(
  comparison?: ClosingComparison,
): [string, ...(number | null)[]][] {
  return ['cash', 'benefit', 'card'].map((method) => {
    const line = comparison?.lines.find((item) => item.method === method)
    return [
      methodLabel(method),
      line?.recorded ?? null,
      line?.expected ?? null,
      line?.actual ?? null,
      line?.difference ?? null,
    ]
  })
}

export const activityLabels: Record<ClosingActivity['kind'], string> = {
  sale: 'Invoice issued',
  payment: 'Invoice payment',
  credit: 'Return / cancellation credit',
  refund: 'Refund paid',
  gift_card_redemption: 'Gift card redeemed',
  repair_payment: 'Repair payment',
}

export const reportNotes = [
  'Payments and refunds are grouped by the invoice’s issuing branch, using the recorded collection branch only for legacy invoices without an issuer. Confirm they were handled here before closing. Each activity uses its recorded day in the business timezone, including payments on older invoices.',
  'Invoice totals include VAT and gift card sales, after discounts. Credits reduce invoiced activity; refunds reduce receipts. Gift card tender is separate from external receipts.',
  'Taxable amount and VAT are the saved figures on invoices issued that day, before credits. This is an operational report, not a VAT return.',
  'Closing saves the counted amounts and recorded figures together, then locks the branch day. Refresh and review any new activity before closing.',
  'Past reports and closed days are read-only. From the fixed go-live date, earlier missed closings block new financial activity until a manager records a separate resolution. That resolution preserves the figures and leaves the day unreconciled.',
  'Opening cash is saved separately and read-only at closing. Cash expenses reduce expected drawer cash; do not also include them as cash banked or transferred out. Benefit/Card expenses do not reduce merchant receipt totals.',
]

export function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Boolean(parseFilterDate(value))
}

export function formatBhd(value: number): string {
  return value.toLocaleString('en-BH', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })
}

export function methodLabel(method: string | null): string {
  return (
    (
      {
        cash: 'Cash',
        benefit: 'Benefit',
        card: 'Card',
        gift_card: 'Gift card',
        unknown: 'Unrecorded method',
      } as Partial<Record<string, string>>
    )[method ?? 'unknown'] ??
    method ??
    'Unrecorded method'
  )
}

export function activityTime(value: string, timezone: string): string {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: timezone })
}

export function summaryRows(report: SalesClosing): [string, number][] {
  const s = report.summary
  return [
    ['Invoices issued', s.invoiceCount],
    ['Invoice total (VAT inclusive)', s.invoiceTotal],
    ['Taxable amount on issued invoices', s.taxableAmount],
    ['VAT on issued invoices', s.vatAmount],
    ['Gift card sales (VAT included)', s.giftCardSales],
    ['Return / cancellation credits', s.credits],
    ['Net invoiced activity', s.netInvoiceActivity],
    ['Invoice payments received', s.invoicePayments],
    ['Repair payments received', s.repairPayments],
    ['External refunds paid', s.externalRefunds],
    ['Net external receipts', s.netExternalReceipts],
    [
      'Paid expenses (all methods)',
      report.tenders.reduce(
        (sum, tender) => sum + Math.round(tender.expenses * 1000),
        0,
      ) / 1000,
    ],
    [
      'Cash expenses from drawer',
      report.tenders.find((tender) => tender.method === 'cash')?.expenses ?? 0,
    ],
    [
      'Net cash receipts less cash expenses',
      report.tenders.find((tender) => tender.method === 'cash')
        ?.afterExpenses ?? 0,
    ],
    ['Gift cards redeemed', s.giftCardRedemptions],
    ['Gift card refunds restored', s.giftCardRefunds],
  ]
}
