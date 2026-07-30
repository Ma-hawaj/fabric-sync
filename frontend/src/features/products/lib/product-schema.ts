import { z } from 'zod'

// A blank string means "not entered yet" — mirrors NumberInput in
// types/product-form.ts.
const quantityInputSchema = z.union([
  z.number().positive('Enter a quantity greater than 0.'),
  z.literal(''),
])

const priceInputSchema = z.union([
  z.number().nonnegative('Enter a price of 0 or more.'),
  z.literal(''),
])

const stockEntrySchema = z
  .object({
    key: z.string(),
    locationId: z.string(),
    quantity: quantityInputSchema,
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

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a product name.'),
    sku: z.string(),
    unitPrice: priceInputSchema,
    isActive: z.boolean(),
    // Stock is optional — a product can be catalogued before any arrives.
    entries: z.array(stockEntrySchema),
  })
  .superRefine((value, ctx) => {
    if (value.unitPrice === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a price.',
        path: ['unitPrice'],
      })
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
