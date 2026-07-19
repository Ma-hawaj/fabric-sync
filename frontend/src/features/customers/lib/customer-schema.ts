import { z } from 'zod'

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a full name.'),
  mobileNo: z.string().trim().min(1, 'Enter a phone number.'),
})
