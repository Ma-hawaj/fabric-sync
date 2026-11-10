import { describe, expect, it } from 'vitest'
import {
  expenseSchema,
  openingCorrectionSchema,
  openingSchema,
  voidExpenseSchema,
} from './till-schema'

describe('opening and expense validation', () => {
  it('requires an explicit opening and a reason for opening corrections', () => {
    expect(
      openingSchema.safeParse({ openingAmount: '', openingNotes: '' }).success,
    ).toBe(false)
    expect(
      openingSchema.safeParse({ openingAmount: 0, openingNotes: '' }).success,
    ).toBe(true)
    expect(
      openingCorrectionSchema.safeParse({ openingAmount: 20, openingNotes: '' })
        .success,
    ).toBe(false)
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
      expect(
        expenseSchema.safeParse({ ...valid, expenseAmount: amount }).success,
      ).toBe(false)
    expect(
      expenseSchema.safeParse({ ...valid, expenseReason: '  ' }).success,
    ).toBe(false)
    expect(
      expenseSchema.safeParse({ ...valid, expensePaymentType: 'gift_card' })
        .success,
    ).toBe(false)
    expect(voidExpenseSchema.safeParse({ voidReason: '' }).success).toBe(false)
  })
})
