import { z } from 'zod'
import { isValidPhoneNumber } from 'react-phone-number-input'

export const recipientPhoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => isValidPhoneNumber(value),
    'Enter a valid recipient phone number.',
  )

// A blank string means "not entered yet" — mirrors NumberInput in
// types/gift-card-form.ts.
const amountInputSchema = z.union([
  z.number().positive('Enter an amount greater than 0.'),
  z.literal(''),
])

export const giftCardFormSchema = z
  .object({
    boughtFor: z.string().trim(),
    recipientPhone: recipientPhoneSchema,
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
