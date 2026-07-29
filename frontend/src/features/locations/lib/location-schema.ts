import { z } from 'zod'

export const locationFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a location name.'),
    receivesOrders: z.boolean(),
    holdsStock: z.boolean(),
    isActive: z.boolean(),
  })
  // A location that neither takes customer orders nor holds stock would never
  // appear in a picker, so it is rejected here as well as in the backend.
  .refine((value) => value.receivesOrders || value.holdsStock, {
    message: 'Pick at least one thing this location is used for.',
    path: ['receivesOrders'],
  })
