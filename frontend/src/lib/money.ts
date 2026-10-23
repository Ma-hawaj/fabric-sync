import { z } from 'zod'

export function isMoney(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 99_999_999.99 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  )
}

export const moneyInputSchema = z
  .union([z.number(), z.literal('')])
  .refine(isMoney, {
    message: 'Enter a nonnegative amount with at most two decimal places.',
  })
