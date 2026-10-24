import { z } from 'zod'
import type { NumberInput } from '@/features/invoices/types/invoice-form'
import type { ReturnableLine, ReturnContext } from '../types/returns'
import {
  adjustmentSummary,
  createRefundSettings,
  refundFields,
  validateRefundSettings,
} from './refund-plan'
import type { RefundSettings } from './refund-plan'

const cents = (value: number) => Math.round(value * 100)
const twoDecimals = (value: number) =>
  Math.abs(value * 100 - cents(value)) < 1e-6

export function remainingQuantity(line: ReturnableLine) {
  return (cents(line.quantity) - cents(line.returnedQuantity)) / 100
}

export function eligibleLines(lines: ReturnableLine[]) {
  return lines.filter(
    (line) =>
      line.outcome === 'active' &&
      line.collected &&
      remainingQuantity(line) > 0,
  )
}

export function previewCredit(line: ReturnableLine, quantity: number) {
  const sold = BigInt(cents(line.quantity))
  if (sold <= 0n || !Number.isFinite(quantity)) return 0
  const returned = BigInt(cents(line.returnedQuantity) + cents(quantity))
  const target = (BigInt(cents(line.creditLimit)) * returned + sold / 2n) / sold
  return (Number(target) - cents(line.creditedAmount)) / 100
}

interface ReturnFormValues extends RefundSettings {
  reason: string
  lines: {
    lineId: string
    quantity: NumberInput
    restock: boolean
    restockLocationId: string
  }[]
}

export function createReturnForm(
  lines: ReturnableLine[],
  orderId?: string,
): ReturnFormValues {
  return {
    reason: '',
    ...createRefundSettings(),
    lines: eligibleLines(lines)
      .filter((line) => !orderId || line.lineId === orderId)
      .map((line) => ({
        lineId: line.lineId,
        quantity: orderId ? 1 : '',
        restock: false,
        restockLocationId: line.defaultRestockLocationId ?? '',
      })),
  }
}

export function returnSchema(context: ReturnContext) {
  const lines = context.lines
  return z
    .object({
      ...refundFields,
      reason: z
        .string()
        .trim()
        .min(1, 'Enter a reason.')
        .max(1000, 'Use at most 1000 characters.'),
      lines: z.array(
        z.object({
          lineId: z.string(),
          quantity: z.union([z.number(), z.literal('')]),
          restock: z.boolean(),
          restockLocationId: z.string(),
        }),
      ),
    })
    .superRefine((value, ctx) => {
      let selected = 0
      const seen = new Set<string>()
      value.lines.forEach((item, index) => {
        if (item.quantity === '' || item.quantity === 0) return
        selected++
        const line = lines.find((entry) => entry.lineId === item.lineId)
        const valid =
          line &&
          line.outcome === 'active' &&
          line.collected &&
          !seen.has(item.lineId) &&
          item.quantity > 0 &&
          twoDecimals(item.quantity) &&
          cents(item.quantity) <= cents(remainingQuantity(line)) &&
          (line.kind !== 'order' || item.quantity === 1)
        seen.add(item.lineId)
        if (!valid)
          ctx.addIssue({
            code: 'custom',
            path: ['lines', index, 'quantity'],
            message:
              'Enter an eligible quantity with at most two decimal places.',
          })
        if (item.restock && !line?.canRestock)
          ctx.addIssue({
            code: 'custom',
            path: ['lines', index, 'restock'],
            message: 'This item cannot be restocked.',
          })
        if (item.restock && !item.restockLocationId.trim())
          ctx.addIssue({
            code: 'custom',
            path: ['lines', index, 'restockLocationId'],
            message: 'Select a restock location.',
          })
      })
      if (selected === 0)
        ctx.addIssue({
          code: 'custom',
          path: ['lines'],
          message: 'Select at least one item to return.',
        })
      const credit = returnCredit(context.lines, value.lines)
      validateRefundSettings(
        context,
        adjustmentSummary(context, credit).refundDue,
        value,
        ctx,
      )
    })
}

export function returnCredit(
  lines: ReturnableLine[],
  items: ReturnFormValues['lines'],
) {
  const total = items.reduce((sum, item) => {
    const line = lines.find((entry) => entry.lineId === item.lineId)
    return (
      sum +
      (line &&
      item.quantity !== '' &&
      item.quantity > 0 &&
      item.quantity <= remainingQuantity(line)
        ? Math.round(previewCredit(line, item.quantity) * 100)
        : 0)
    )
  }, 0)
  return total / 100
}

export function refundLimit(context: ReturnContext, destination: string) {
  const tender = destination.startsWith('gift_card:')
    ? (context.giftCards.find((card) => card.id === destination.slice(10))
        ?.refundableAmount ?? 0)
    : ['benefit', 'cash', 'card'].includes(destination)
      ? context.settlement.netAmountPaid
      : 0
  return Math.min(context.settlement.refundDue, tender)
}

export function createRefundForm(): {
  reason: string
  amount: NumberInput
  destination: string
} {
  return { reason: '', amount: '', destination: '' }
}

export function refundSchema(context: ReturnContext) {
  return z
    .object({
      reason: z
        .string()
        .trim()
        .min(1, 'Enter a reason.')
        .max(1000, 'Use at most 1000 characters.'),
      amount: z.union([z.number(), z.literal('')]),
      destination: z.string().min(1, 'Select a refund method.'),
    })
    .superRefine((value, ctx) => {
      if (
        value.amount === '' ||
        value.amount <= 0 ||
        !twoDecimals(value.amount)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'Enter a positive amount with at most two decimal places.',
        })
      } else if (
        cents(value.amount) > cents(refundLimit(context, value.destination))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'This exceeds the refundable amount for this method.',
        })
      }
    })
}
