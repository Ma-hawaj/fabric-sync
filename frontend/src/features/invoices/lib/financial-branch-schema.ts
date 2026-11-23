import { z } from 'zod'

export const financialBranchSchema = z.object({
  branchId: z.uuid('Choose a financial branch.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Enter a reason for assigning this branch.')
    .max(1000, 'Use 1000 characters or fewer.'),
})
