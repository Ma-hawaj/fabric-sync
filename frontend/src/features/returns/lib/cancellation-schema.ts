import { z } from 'zod'
import type { NumberInput } from '@/features/invoices/types/invoice-form'
import type { CancellationContext } from '../types/returns'
import {
  adjustmentSummary,
  createRefundSettings,
  refundFields,
  validateRefundSettings,
} from './refund-plan'
import type { RefundSettings } from './refund-plan'

interface CancellationForm extends RefundSettings {
  reason: string
  retainedCharge: NumberInput
  restoredMaterialQuantity: NumberInput
  workChargeConfirmed: boolean
  unusedMaterialConfirmed: boolean
}

export function createCancellationForm(): CancellationForm {
  return {
    ...createRefundSettings(),
    reason: '',
    retainedCharge: 0,
    restoredMaterialQuantity: 0,
    workChargeConfirmed: false,
    unusedMaterialConfirmed: false,
  }
}

export function cancellationValue(context: CancellationContext) {
  return (
    context.invoice.lines.find((line) => line.lineId === context.order.orderId)
      ?.creditLimit ?? 0
  )
}

export function cancellationSchema(context: CancellationContext) {
  return z
    .object({
      ...refundFields,
      reason: z
        .string()
        .trim()
        .min(1, 'Enter a reason.')
        .max(1000, 'Use at most 1000 characters.'),
      retainedCharge: z.union([z.number(), z.literal('')]),
      restoredMaterialQuantity: z.union([z.number(), z.literal('')]),
      workChargeConfirmed: z.boolean(),
      unusedMaterialConfirmed: z.boolean(),
    })
    .superRefine((values, ctx) => {
      const limit = cancellationValue(context)
      const valid = (value: NumberInput) =>
        value !== '' &&
        value >= 0 &&
        Number.isFinite(value) &&
        Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
      if (
        !valid(values.retainedCharge) ||
        Number(values.retainedCharge) > limit ||
        (!context.order.productionStarted && values.retainedCharge !== 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['retainedCharge'],
          message: context.order.productionStarted
            ? 'Enter a retained charge between zero and the discounted order value, with at most two decimal places.'
            : 'Cancellation before production starts receives full credit.',
        })
      }
      if (context.order.productionStarted && !values.workChargeConfirmed)
        ctx.addIssue({
          code: 'custom',
          path: ['workChargeConfirmed'],
          message:
            'Confirm that the retained charge was agreed with the customer.',
        })
      if (
        !valid(values.restoredMaterialQuantity) ||
        Number(values.restoredMaterialQuantity) >
          context.order.materialAmount ||
        (Number(values.restoredMaterialQuantity) > 0 &&
          (!context.order.canRestoreMaterial ||
            !values.unusedMaterialConfirmed))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['restoredMaterialQuantity'],
          message:
            'Restore only confirmed unused fabric, up to the original quantity.',
        })
      }
      const credit = Math.max(0, limit - Number(values.retainedCharge))
      validateRefundSettings(
        context.invoice,
        adjustmentSummary(context.invoice, credit).refundDue,
        values,
        ctx,
      )
    })
}
