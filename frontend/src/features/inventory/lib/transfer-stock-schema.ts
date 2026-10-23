import { z } from 'zod'
import { isMoney } from '@/lib/money'

export const transferStockSchema = (
  available: Record<string, number>,
  destinations: string[],
) =>
  z
    .object({
      fromLocationId: z.string().min(1, 'Pick a source location.'),
      toLocationId: z.string().min(1, 'Pick a destination location.'),
      quantity: z.union([z.number(), z.literal('')]),
    })
    .superRefine((value, ctx) => {
      if (value.fromLocationId && !(value.fromLocationId in available))
        ctx.addIssue({
          code: 'custom',
          path: ['fromLocationId'],
          message: 'Pick a location with available stock.',
        })
      if (
        value.toLocationId &&
        (!destinations.includes(value.toLocationId) ||
          value.fromLocationId === value.toLocationId)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['toLocationId'],
          message: 'Pick a different active location that holds stock.',
        })
      if (!isMoney(value.quantity) || value.quantity < 0.01)
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message:
            'Enter a quantity of at least 0.01 with at most two decimal places.',
        })
      else if (value.quantity > (available[value.fromLocationId] ?? 0))
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message: 'This is more than the available stock.',
        })
    })
