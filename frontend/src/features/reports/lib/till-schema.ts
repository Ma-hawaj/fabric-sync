import { z } from 'zod'

export const tillAmount = z
  .union([z.number(), z.literal('')])
  .refine(
    (value) =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 99_999_999.999 &&
      Math.abs(value * 1000 - Math.round(value * 1000)) < 0.0001,
    'Enter a nonnegative BHD amount with at most three decimal places.',
  )

export const openingSchema = z.object({
  openingAmount: tillAmount,
  openingNotes: z.string().max(2000, 'Keep notes within 2,000 characters.'),
})
export const openingCorrectionSchema = openingSchema.refine(
  (value) => Boolean(value.openingNotes.trim()),
  {
    path: ['openingNotes'],
    message: 'Explain why the saved opening needs correcting.',
  },
)
export const expenseSchema = z.object({
  expenseAmount: tillAmount.refine(
    (value) => value !== '' && value > 0,
    'Enter an expense greater than zero.',
  ),
  expensePaymentType: z.enum(['cash', 'benefit', 'card']),
  expenseReason: z
    .string()
    .trim()
    .min(1, 'Enter the expense reason.')
    .max(1000, 'Keep the reason within 1,000 characters.'),
  expensePaidTo: z.string().max(200, 'Keep the payee within 200 characters.'),
  expenseReference: z
    .string()
    .max(200, 'Keep the reference within 200 characters.'),
})
export const voidExpenseSchema = z.object({
  voidReason: z
    .string()
    .trim()
    .min(1, 'Explain why this expense is being voided.')
    .max(1000, 'Keep the reason within 1,000 characters.'),
})
