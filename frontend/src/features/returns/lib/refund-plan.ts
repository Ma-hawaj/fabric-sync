import { z } from 'zod'
import type { RefundPlan, ReturnContext } from '../types/returns'

export interface RefundSettings {
  refundTiming: 'now' | 'later'
  refundMethod: '' | 'cash' | 'benefit' | 'card'
  refundToGiftCard: boolean
}

export const refundFields = {
  refundTiming: z.enum(['now', 'later']),
  refundMethod: z.enum(['', 'cash', 'benefit', 'card']),
  refundToGiftCard: z.boolean(),
}

export function createRefundSettings(): RefundSettings {
  return { refundTiming: 'now', refundMethod: '', refundToGiftCard: false }
}

export function adjustmentSummary(context: ReturnContext, credit: number) {
  const value = Math.max(0, Math.round(credit * 100))
  const applied = Math.min(
    value,
    Math.round(context.settlement.balanceDue * 100),
  )
  return {
    appliedToBalance: applied / 100,
    refundDue:
      (Math.round(context.settlement.refundDue * 100) + value - applied) / 100,
  }
}

// Split the exact amount across held external tender and original cards. The
// selected priority is shown to staff before they confirm the single action.
export function refundAllocation(
  context: ReturnContext,
  due: number,
  giftFirst: boolean,
) {
  let remaining = Math.max(0, Math.round(due * 100))
  let cash = 0
  const gifts: { id: string; code: string; amount: number }[] = []
  const allocateCash = () => {
    cash = Math.min(
      remaining,
      Math.max(0, Math.round(context.settlement.netAmountPaid * 100)),
    )
    remaining -= cash
  }
  if (!giftFirst) allocateCash()
  for (const card of context.giftCards) {
    const amount = Math.min(
      remaining,
      Math.max(0, Math.round(card.refundableAmount * 100)),
    )
    if (amount > 0)
      gifts.push({ id: card.id, code: card.code, amount: amount / 100 })
    remaining -= amount
  }
  if (giftFirst) allocateCash()
  return { cash: cash / 100, gifts, uncovered: remaining / 100 }
}

export function validateRefundSettings(
  context: ReturnContext,
  due: number,
  values: RefundSettings,
  ctx: z.RefinementCtx,
) {
  if (values.refundTiming === 'later' || due === 0) return
  const allocation = refundAllocation(context, due, values.refundToGiftCard)
  if (allocation.cash > 0 && values.refundMethod === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['refundMethod'],
      message: 'Select the method used to pay the customer back.',
    })
  }
  if (allocation.uncovered > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['refundTiming'],
      message:
        'The available payment channels do not cover this refund. Refresh the invoice.',
    })
  }
}

export function buildRefundPlan(
  context: ReturnContext,
  due: number,
  values: RefundSettings,
): RefundPlan {
  if (values.refundTiming === 'later' && due > 0) return { timing: 'later' }
  const allocation = refundAllocation(context, due, values.refundToGiftCard)
  const payments: Extract<RefundPlan, { timing: 'now' }>['payments'] =
    allocation.gifts.map((gift) => ({
      amount: gift.amount,
      paymentType: 'gift_card',
      giftCardId: gift.id,
    }))
  if (allocation.cash > 0 && values.refundMethod !== '') {
    payments.unshift({
      amount: allocation.cash,
      paymentType: values.refundMethod,
      giftCardId: null,
    })
  }
  return { timing: 'now', payments }
}
