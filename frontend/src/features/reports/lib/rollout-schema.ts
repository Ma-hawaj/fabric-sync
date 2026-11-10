import { z } from 'zod'
import { isReportDate } from './sales-closing'

export function nextBusinessDate(date: string): string {
  const day = new Date(`${date}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

export function rolloutSchema(today: string) {
  return z.object({
    startsOn: z
      .string()
      .refine(isReportDate, 'Choose a valid go-live date.')
      .refine((date) => date >= today, 'Choose today or a future date.'),
  })
}

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
