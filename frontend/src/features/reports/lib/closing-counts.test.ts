import { describe, expect, it } from 'vitest'
import { closingFixture } from '../test-fixtures'
import { compareCounts, countsSchema, emptyCounts } from './closing-counts'
import type { ClosingCounts } from '../types/sales-closing'

const counts = (): ClosingCounts => ({
  branchActivityConfirmed: true,
  openingCash: 20,
  cashAdded: 0,
  cashRemoved: 0,
  actualCash: 72,
  actualBenefit: 0,
  actualCard: 0,
  notes: '',
})

function expectIssue(
  result: {
    success: boolean
    error?: { issues: { path: PropertyKey[]; message: string }[] }
  },
  path: string,
  message: RegExp,
) {
  expect(result.success).toBe(false)
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: [path],
        message: expect.stringMatching(message),
      }),
    ]),
  )
}

describe('branch reconciliation', () => {
  it('accounts for the float and cash movements and compares methods independently', () => {
    const report = closingFixture()
    const input = {
      ...counts(),
      cashAdded: 10,
      cashRemoved: 15,
      actualCash: 67,
      notes: 'Petty cash added 10; banked 15.',
    }
    expect(countsSchema(report).safeParse(input).success).toBe(true)
    const compared = compareCounts(report, input)
    expect(compared.matched).toBe(true)
    expect(compared.lines[0]).toMatchObject({
      recorded: 52,
      expected: 67,
      actual: 67,
      difference: 0,
    })
    expect(
      compareCounts(report, { ...input, actualCard: 2 }).lines[2].difference,
    ).toBe(2)
  })
  it('never treats blank counts or unconfirmed activity as a completed check', () => {
    expectIssue(
      countsSchema(closingFixture()).safeParse(emptyCounts()),
      'actualCash',
      /BHD amount/i,
    )
    expectIssue(
      countsSchema(closingFixture()).safeParse({
        ...counts(),
        branchActivityConfirmed: false,
      }),
      'branchActivityConfirmed',
      /confirm.*handled here/i,
    )
  })
  it('retains one-fils differences and requires an explanation', () => {
    const report = closingFixture()
    const input = { ...counts(), actualCash: 71.999 }
    expect(compareCounts(report, input).lines[0].difference).toBe(-0.001)
    expectIssue(
      countsSchema(report).safeParse(input),
      'notes',
      /explain differences/i,
    )
    expect(
      countsSchema(report).safeParse({ ...input, notes: 'One fils short.' })
        .success,
    ).toBe(true)
    expectIssue(
      countsSchema(report).safeParse({ ...counts(), actualCash: 72.0001 }),
      'actualCash',
      /three decimal places/i,
    )
  })
  it('keeps unresolved methods and unassigned activity out of a matched status', () => {
    const report = closingFixture()
    report.summary.unrecordedMethodCount = 2
    expect(compareCounts(report, counts()).matched).toBe(false)
    expectIssue(
      countsSchema(report).safeParse(counts()),
      'notes',
      /explain differences/i,
    )
    report.summary.unrecordedMethodCount = 0
    report.unassignedActivityCount = 1
    expect(compareCounts(report, counts()).matched).toBe(false)
  })
  it('uses saved opening and subtracts recorded cash expenses without changing terminal totals', () => {
    const report = closingFixture()
    report.tenders[0].expenses = 5.005
    report.tenders[0].afterExpenses = 46.995
    report.tenders.push({
      method: 'card',
      invoicePayments: 0,
      repairPayments: 0,
      refunds: 0,
      net: 0,
      expenses: 3,
      afterExpenses: -3,
    })
    const input = { ...counts(), actualCash: 66.995 }
    const compared = compareCounts(report, input)
    expect(compared.lines[0].expected).toBe(66.995)
    expect(compared.lines[2].expected).toBe(0)
    expect(compared.matched).toBe(true)
    expectIssue(
      countsSchema(report).safeParse({ ...input, openingCash: 30 }),
      'openingCash',
      /separately saved opening/i,
    )
    report.opening = null
    expect(compareCounts(report, input).matched).toBe(false)
    expectIssue(
      countsSchema(report).safeParse(input),
      'openingCash',
      /separately saved opening/i,
    )
  })
})
