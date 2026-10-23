import { z } from 'zod'
import { isMoney } from '@/lib/money'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/inventory-form.ts.
const numberInputSchema = z.union([
  z.number().positive('Enter a quantity greater than 0.'),
  z.literal(''),
])

const stockEntrySchema = z
  .object({
    key: z.string(),
    locationId: z.string(),
    quantity: numberInputSchema,
  })
  .superRefine((entry, ctx) => {
    if (!entry.locationId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a location.',
        path: ['locationId'],
      })
    }

    if (entry.quantity === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a quantity.',
        path: ['quantity'],
      })
    }
  })

export const inventoryFormSchema = z
  .object({
    mode: z.enum(['existing', 'new']),
    materialId: z.string(),
    name: z.string(),
    sku: z.string(),
    unit: z.string(),
    // Optional free text — blank stays blank and is sent as null.
    family: z.string(),
    juniorPrice: z.union([z.number(), z.literal('')]),
    normalPrice: z.union([z.number(), z.literal('')]),
    largePrice: z.union([z.number(), z.literal('')]),
    entries: z.array(stockEntrySchema).min(1, 'Add at least one location.'),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'existing' && !value.materialId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a material.',
        path: ['materialId'],
      })
    }

    if (value.mode === 'new' && !value.name.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a material name.',
        path: ['name'],
      })
    }

    if (value.mode === 'new') {
      for (const field of [
        'juniorPrice',
        'normalPrice',
        'largePrice',
      ] as const) {
        if (!isMoney(value[field]))
          ctx.addIssue({
            code: 'custom',
            message:
              'Enter a nonnegative price with at most two decimal places.',
            path: [field],
          })
      }
    }

    const seenLocations = new Set<string>()
    value.entries.forEach((entry, index) => {
      if (!entry.locationId || !seenLocations.has(entry.locationId)) {
        seenLocations.add(entry.locationId)
        return
      }

      ctx.addIssue({
        code: 'custom',
        message: 'Each location can only be added once.',
        path: ['entries', index, 'locationId'],
      })
    })
  })
