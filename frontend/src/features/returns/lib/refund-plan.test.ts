import { describe, expect, it } from 'vitest'
import { CONTEXT } from '../test-fixtures'
import {
  adjustmentSummary,
  buildRefundPlan,
  createRefundSettings,
  refundAllocation,
} from './refund-plan'

describe('combined refund plan', () => {
  it('offsets unpaid debt before paying money back, including earlier pending credit', () => {
    const context = {
      ...CONTEXT,
      settlement: { ...CONTEXT.settlement, balanceDue: 80, refundDue: 0 },
    }
    expect(adjustmentSummary(context, 50)).toEqual({
      appliedToBalance: 50,
      refundDue: 0,
    })
    expect(adjustmentSummary(context, 100)).toEqual({
      appliedToBalance: 80,
      refundDue: 20,
    })
    expect(adjustmentSummary(CONTEXT, 3.33)).toEqual({
      appliedToBalance: 0,
      refundDue: 53.33,
    })
  })

  it('refunds mixed tender in one exact plan without cashing out gift card value', () => {
    expect(
      buildRefundPlan(CONTEXT, 53.33, {
        ...createRefundSettings(),
        refundMethod: 'benefit',
      }),
    ).toEqual({
      timing: 'now',
      payments: [
        { amount: 30, paymentType: 'benefit', giftCardId: null },
        { amount: 23.33, paymentType: 'gift_card', giftCardId: 'gift-1' },
      ],
    })
    expect(refundAllocation(CONTEXT, 100, false).uncovered).toBe(0)
    expect(refundAllocation(CONTEXT, 100.01, false).uncovered).toBe(0.01)
  })

  it('can restore original gift cards first and only asks for external tender when needed', () => {
    expect(
      buildRefundPlan(CONTEXT, 50, {
        ...createRefundSettings(),
        refundToGiftCard: true,
      }),
    ).toEqual({
      timing: 'now',
      payments: [
        { amount: 50, paymentType: 'gift_card', giftCardId: 'gift-1' },
      ],
    })
    const context = {
      ...CONTEXT,
      giftCards: [
        { id: 'first', code: 'GC-A', refundableAmount: 0.1 },
        { id: 'second', code: 'GC-B', refundableAmount: 0.2 },
      ],
    }
    expect(refundAllocation(context, 0.3, true)).toEqual({
      cash: 0,
      gifts: [
        { id: 'first', code: 'GC-A', amount: 0.1 },
        { id: 'second', code: 'GC-B', amount: 0.2 },
      ],
      uncovered: 0,
    })
  })

  it('leaves money pending only when explicitly selected, with no payouts for unpaid returns', () => {
    const settings = {
      ...createRefundSettings(),
      refundTiming: 'later' as const,
    }
    expect(buildRefundPlan(CONTEXT, 50, settings)).toEqual({ timing: 'later' })
    expect(buildRefundPlan(CONTEXT, 0, settings)).toEqual({
      timing: 'now',
      payments: [],
    })
  })
})
