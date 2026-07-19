import { z } from 'zod'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/inventory-form.ts.
const numberInputSchema = z.union([
  z.number().positive('Enter a quantity greater than 0.'),
  z.literal(''),
])

export const inventoryFormSchema = z
  .object({
    mode: z.enum(['existing', 'new']),
    materialId: z.string(),
    name: z.string(),
    sku: z.string(),
    unit: z.string(),
    location: z.string(),
    quantity: numberInputSchema,
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

    if (!value.location) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a location.',
        path: ['location'],
      })
    }

    if (value.quantity === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a quantity.',
        path: ['quantity'],
      })
    }
  })
