import { z } from 'zod'
import type {
  ClosingComparison,
  ClosingCounts,
  SalesClosing,
} from '../types/sales-closing'

export type CountDraft = Record<
  keyof Omit<ClosingCounts, 'notes' | 'branchActivityConfirmed'>,
  number | ''
> & { notes: string; branchActivityConfirmed: boolean }

export function emptyCounts(): CountDraft {
  return {
    openingCash: '',
    cashAdded: '',
    cashRemoved: '',
    actualCash: '',
    actualBenefit: '',
    actualCard: '',
    notes: '',
    branchActivityConfirmed: false,
  }
}

const signedAmount = z
  .union([z.number(), z.literal('')])
  .refine(
    (value) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= 99_999_999.999 &&
      Math.abs(value * 1000 - Math.round(value * 1000)) < 0.0001,
    'Enter a BHD amount with at most three decimal places.',
  )
const cashAmount = signedAmount.refine(
  (value) => value === '' || value >= 0,
  'Enter a nonnegative amount.',
)

export function compareCounts(
  report: SalesClosing,
  counts: ClosingCounts,
): ClosingComparison {
  const lines = (['cash', 'benefit', 'card'] as const).map((method) => {
    const recorded = Math.round(
      (report.tenders.find((tender) => tender.method === method)?.net ?? 0) *
        1000,
    )
    const expected =
      recorded +
      (method === 'cash'
        ? Math.round((report.opening?.amount ?? 0) * 1000) +
          Math.round(counts.cashAdded * 1000) -
          Math.round(counts.cashRemoved * 1000) -
          Math.round(
            (report.tenders.find((tender) => tender.method === 'cash')
              ?.expenses ?? 0) * 1000,
          )
        : 0)
    const actual = Math.round(
      {
        cash: counts.actualCash,
        benefit: counts.actualBenefit,
        card: counts.actualCard,
      }[method] * 1000,
    )
    return {
      method,
      recorded: recorded / 1000,
      expected: expected / 1000,
      actual: actual / 1000,
      difference: (actual - expected) / 1000,
    }
  })
  return {
    lines,
    unresolvedMethods: report.summary.unrecordedMethodCount,
    matched:
      Boolean(report.opening) &&
      counts.openingCash === report.opening?.amount &&
      lines.every((line) => line.difference === 0) &&
      report.summary.unrecordedMethodCount === 0 &&
      report.unassignedActivityCount === 0 &&
      counts.branchActivityConfirmed,
  }
}

export function countsSchema(report: SalesClosing) {
  return z
    .object({
      branchActivityConfirmed: z
        .boolean()
        .refine(
          (value) => value,
          'Confirm the listed payments and refunds were handled here.',
        ),
      openingCash: cashAmount,
      cashAdded: cashAmount,
      cashRemoved: cashAmount,
      actualCash: cashAmount,
      actualBenefit: signedAmount,
      actualCard: signedAmount,
      notes: z
        .string()
        .max(2000, 'Keep closing notes within 2,000 characters.'),
    })
    .superRefine((value, ctx) => {
      if (!report.opening || value.openingCash !== report.opening.amount) {
        ctx.addIssue({
          code: 'custom',
          path: ['openingCash'],
          message: 'Opening cash must use the separately saved opening.',
        })
      }
      if (
        Object.entries(value).some(
          ([key, amount]) => key !== 'notes' && amount === '',
        )
      )
        return
      const counts = value as ClosingCounts
      const compared = compareCounts(report, counts)
      if (
        (compared.lines.some((line) => line.difference !== 0) ||
          report.summary.unrecordedMethodCount > 0 ||
          report.unassignedActivityCount > 0 ||
          counts.cashAdded > 0 ||
          counts.cashRemoved > 0) &&
        !counts.notes.trim()
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['notes'],
          message:
            'Explain differences and cash movements in the closing notes.',
        })
      }
    })
}
