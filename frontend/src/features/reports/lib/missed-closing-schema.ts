import { z } from 'zod'

export const missedClosingSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Explain why the closing was missed.')
    .max(2000, 'Keep the explanation within 2,000 characters.'),
  acknowledged: z
    .boolean()
    .refine(
      (value) => value,
      'Confirm the report will remain unreconciled and read-only.',
    ),
})
