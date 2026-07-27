import { z } from 'zod'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/gift-card-form.ts.
const amountInputSchema = z.union([
  z.number().positive('Enter an amount greater than 0.'),
  z.literal(''),
])

export const giftCardFormSchema = z
  .object({
    code: z.string().trim().min(1, 'Enter a gift card code.'),
    amount: amountInputSchema,
    customerId: z.string(),
    expiresOn: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.amount === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an amount.',
        path: ['amount'],
      })
    }
  })
