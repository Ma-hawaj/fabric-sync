import { z } from 'zod'
import type { NumberInput, PaymentType } from '../types/invoice-form'

export interface RecordPaymentFormValues {
  amount: NumberInput
  paymentType: PaymentType | ''
}

export function createEmptyRecordPaymentForm(): RecordPaymentFormValues {
  return { amount: '', paymentType: '' }
}

// The cap is the invoice's live balance, so the schema is built per invoice —
// a payment bigger than what's left would overpay it. The backend enforces
// the same cap, so this is the early, inline refusal.
export function recordPaymentSchema(balanceDue: number) {
  return z
    .object({
      // A blank string means "not entered yet" — mirrors NumberInput in
      // types/invoice-form.ts.
      amount: z.union([z.number(), z.literal('')]),
      paymentType: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.amount === '') {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter an amount.',
          path: ['amount'],
        })
      } else if (value.amount <= 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter an amount greater than zero.',
          path: ['amount'],
        })
      } else if (value.amount - balanceDue > 1e-9) {
        ctx.addIssue({
          code: 'custom',
          message: 'More than the invoice\u2019s remaining balance.',
          path: ['amount'],
        })
      }

      if (!value.paymentType) {
        ctx.addIssue({
          code: 'custom',
          message: 'Pick a payment method.',
          path: ['paymentType'],
        })
      }
    })
}
