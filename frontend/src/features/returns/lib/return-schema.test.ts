import { describe, expect, it } from 'vitest'
import {
  createRefundForm,
  createReturnForm,
  eligibleLines,
  previewCredit,
  refundLimit,
  refundSchema,
  returnSchema,
} from './return-schema'
import { PRODUCT, CONTEXT } from '../test-fixtures'

describe('return rules', () => {
  it('excludes uncollected and completely returned goods', () => {
    expect(
      eligibleLines([
        PRODUCT,
        { ...PRODUCT, collected: false },
        { ...PRODUCT, returnedQuantity: 3 },
      ]),
    ).toEqual([PRODUCT])
  })

  it('requires a reason and an eligible selected quantity', () => {
    const values = createReturnForm([PRODUCT])
    expect(
      returnSchema({ ...CONTEXT, lines: [PRODUCT] }).safeParse(values).success,
    ).toBe(false)
    values.reason = 'Wrong size'
    values.refundMethod = 'cash'
    values.lines[0].quantity = 1
    expect(
      returnSchema({ ...CONTEXT, lines: [PRODUCT] }).safeParse(values).success,
    ).toBe(true)
    for (const quantity of [4, -1, 0.001, Infinity]) {
      values.lines[0].quantity = quantity
      const result = returnSchema({ ...CONTEXT, lines: [PRODUCT] }).safeParse(
        values,
      )
      expect(result.success).toBe(false)
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) => issue.path.join('.') === 'lines.0.quantity',
          ),
        ).toBe(true)
    }
  })

  it('uses whole collected garments and refuses fabric restocking', () => {
    const order = {
      ...PRODUCT,
      kind: 'order' as const,
      quantity: 1,
      canRestock: false,
    }
    const values = createReturnForm([order])
    values.reason = 'Fit issue'
    values.refundMethod = 'cash'
    values.lines[0].quantity = 0.5
    expect(
      returnSchema({ ...CONTEXT, lines: [order] }).safeParse(values).success,
    ).toBe(false)
    values.lines[0].quantity = 1
    values.lines[0].restock = true
    expect(
      returnSchema({ ...CONTEXT, lines: [order] }).safeParse(values).success,
    ).toBe(false)
    values.lines[0].restock = false
    expect(
      returnSchema({ ...CONTEXT, lines: [order] }).safeParse(values).success,
    ).toBe(true)
  })

  it('preserves rounding remainders on repeated partial returns', () => {
    expect(previewCredit(PRODUCT, 1)).toBe(3.33)
    expect(
      previewCredit(
        { ...PRODUCT, returnedQuantity: 1, creditedAmount: 3.33 },
        1,
      ),
    ).toBe(3.34)
    expect(
      previewCredit(
        { ...PRODUCT, returnedQuantity: 2, creditedAmount: 6.67 },
        1,
      ),
    ).toBe(3.33)
  })
})

describe('refund rules', () => {
  it('caps external refunds at the cash tender still held', () => {
    expect(refundLimit(CONTEXT, 'cash')).toBe(30)
    expect(refundLimit(CONTEXT, 'gift_card:gift-1')).toBe(50)
    expect(refundLimit(CONTEXT, 'gift_card:other')).toBe(0)
    expect(refundLimit(CONTEXT, '')).toBe(0)
    expect(
      refundLimit(
        { ...CONTEXT, settlement: { ...CONTEXT.settlement, refundDue: 0 } },
        'cash',
      ),
    ).toBe(0)
  })

  it('requires a method, reason and positive precise amount within that channel', () => {
    const values = createRefundForm()
    expect(refundSchema(CONTEXT).safeParse(values).success).toBe(false)
    Object.assign(values, {
      reason: 'Returned merchandise',
      destination: 'cash',
      amount: 30,
    })
    expect(refundSchema(CONTEXT).safeParse(values).success).toBe(true)
    values.amount = 30.01
    const result = refundSchema(CONTEXT).safeParse(values)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['amount'])
    values.destination = 'gift_card:gift-1'
    values.amount = 50
    expect(refundSchema(CONTEXT).safeParse(values).success).toBe(true)
    values.amount = 0.001
    expect(refundSchema(CONTEXT).safeParse(values).success).toBe(false)
  })
})
