import { parseFilterDate } from '@/lib/filter-date'
import type { ClosingActivity, SalesClosing } from '../types/sales-closing'

export const activityLabels: Record<ClosingActivity['kind'], string> = {
  sale: 'Invoice issued',
  payment: 'Invoice payment',
  credit: 'Return / cancellation credit',
  refund: 'Refund paid',
  gift_card_redemption: 'Gift card redeemed',
  repair_payment: 'Repair payment',
}

export const reportNotes = [
  'Payments and refunds are grouped by the invoice’s issuing branch, using the recorded collection branch only for legacy invoices without an issuer. Confirm they were handled here before saving a check. Each activity uses its recorded day in the business timezone, including payments on older invoices.',
  'Invoice totals include VAT and gift card sales, after discounts. Credits reduce invoiced activity; refunds reduce receipts. Gift card tender is separate from external receipts.',
  'Taxable amount and VAT are the saved figures on invoices issued that day, before credits. This is an operational report, not a VAT return.',
  'A saved check preserves counted amounts and the recorded figures at that time. New or changed activity requires another check. Saving does not lock the till or change payment records.',
  'Final closing locks the saved report, opening cash and expenses. Explained shortages or overages remain visible. The branch cannot record new sales or financial activity until the next business day has an opening and all earlier active days are closed.',
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
    ['Gift card sales (outside VAT)', s.giftCardSales],
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
