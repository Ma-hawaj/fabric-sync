import { z } from 'zod'

// A blank string means "not entered yet", matching NumberField and the
// `number | ''` shape in types/order-stage-form.ts.
export const orderStageFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a stage name.'),
  sortOrder: z.union([
    z.number().int().min(1, 'Enter a position of 1 or more.'),
    z.literal('').refine(() => false, { message: 'Enter a position.' }),
  ]),
  requiresDelivery: z.boolean(),
  isActive: z.boolean(),
})
