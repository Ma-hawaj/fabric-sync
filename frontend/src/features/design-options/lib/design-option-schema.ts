import { z } from 'zod'
import { moneyInputSchema } from '@/lib/money'

// A blank string means "not entered yet", matching NumberField and the
// `number | ''` shape in types/design-option-form.ts. The illustration itself
// is validated server-side (type, magic bytes, 2 MB cap) — the form only
// carries its data URL through.
export const designOptionFormSchema = z.object({
  category: z.enum(
    [
      'thob_type',
      'neck',
      'sleeve',
      'front_pocket',
      'side_pocket',
      'patti',
      'emd',
    ],
    { message: 'Pick a design category.' },
  ),
  slug: z
    .string()
    .trim()
    .min(1, 'Enter an option id.')
    .max(60, 'Keep the id to 60 characters or fewer.'),
  label: z
    .string()
    .trim()
    .min(1, 'Enter a display label.')
    .max(120, 'Keep the label to 120 characters or fewer.'),
  sortOrder: z.union([
    z.number().int().min(1, 'Enter a position of 1 or more.'),
    z.literal('').refine(() => false, { message: 'Enter a position.' }),
  ]),
  cost: moneyInputSchema,
  isActive: z.boolean(),
  imageDataUrl: z.string().nullable(),
})
