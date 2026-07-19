import { z } from 'zod'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/inventory-form.ts.
const numberInputSchema = z.union([
  z.number().positive('Enter a quantity greater than 0.'),
  z.literal(''),
])

const stockEntrySchema = z
  .object({
    key: z.string(),
    location: z.string(),
    quantity: numberInputSchema,
  })
  .superRefine((entry, ctx) => {
    if (!entry.location) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a location.',
        path: ['location'],
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

    const seenLocations = new Set<string>()
    value.entries.forEach((entry, index) => {
      if (!entry.location || !seenLocations.has(entry.location)) {
        seenLocations.add(entry.location)
        return
      }

      ctx.addIssue({
        code: 'custom',
        message: 'Each location can only be added once.',
        path: ['entries', index, 'location'],
      })
    })
  })
