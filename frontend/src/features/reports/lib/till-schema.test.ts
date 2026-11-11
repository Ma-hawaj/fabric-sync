import { describe, expect, it } from 'vitest'
import {
  expenseSchema,
  openingCorrectionSchema,
  openingSchema,
  voidExpenseSchema,
} from './till-schema'

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

describe('opening and expense validation', () => {
  it('requires an explicit opening and a reason for opening corrections', () => {
    expectIssue(
      openingSchema.safeParse({ openingAmount: '', openingNotes: '' }),
      'openingAmount',
      /nonnegative BHD amount/i,
    )
    expect(
      openingSchema.safeParse({ openingAmount: 0, openingNotes: '' }).success,
    ).toBe(true)
    expectIssue(
      openingCorrectionSchema.safeParse({
        openingAmount: 20,
        openingNotes: '',
      }),
      'openingNotes',
      /explain.*correcting/i,
    )
    expect(
      openingCorrectionSchema.safeParse({
        openingAmount: 20.005,
        openingNotes: 'Opening recount.',
      }).success,
    ).toBe(true)
  })
  it('accepts paid delivery fees in fils and rejects invalid or unexplained expenses', () => {
    const valid = {
      expenseAmount: 5.005,
      expensePaymentType: 'cash',
      expenseReason: 'Delivery fee',
      expensePaidTo: 'Courier',
      expenseReference: 'D100',
    }
    expect(expenseSchema.safeParse(valid).success).toBe(true)
    for (const amount of ['', 0, -1, 0.0001, Infinity, NaN])
      expectIssue(
        expenseSchema.safeParse({ ...valid, expenseAmount: amount }),
        'expenseAmount',
        typeof amount === 'number' && !Number.isFinite(amount)
          ? /invalid input/i
          : amount === 0
            ? /greater than zero/i
            : /nonnegative BHD amount/i,
      )
    expectIssue(
      expenseSchema.safeParse({ ...valid, expenseReason: '  ' }),
      'expenseReason',
      /enter the expense reason/i,
    )
    expectIssue(
      expenseSchema.safeParse({ ...valid, expensePaymentType: 'gift_card' }),
      'expensePaymentType',
      /invalid option/i,
    )
    expectIssue(
      voidExpenseSchema.safeParse({ voidReason: '' }),
      'voidReason',
      /explain.*voided/i,
    )
  })
})
