import { z } from 'zod'

export const locationFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a location name.'),
    receivesOrders: z.boolean(),
    holdsStock: z.boolean(),
    producesOrders: z.boolean(),
    isActive: z.boolean(),
  })
  // Each capability is independent; production-only workshops are valid.
  .refine(
    (value) => value.receivesOrders || value.holdsStock || value.producesOrders,
    {
      message: 'Pick at least one thing this location is used for.',
      path: ['receivesOrders'],
    },
  )
