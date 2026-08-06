import { z } from 'zod'

// Recipient selection lives in the compose page's data-table row-selection
// state, not here — it's not form-validated data, just a guard-clause check
// before submit (see marketing-campaign-form.tsx).
export const marketingCampaignFormSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Enter a message.')
    .max(1024, 'Keep the message under 1024 characters.'),
})
