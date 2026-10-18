import { CURRENCY } from '@/lib/currency'
import { ApiError } from '@/lib/api'

export const money = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
  }).format(amount)
export const failureMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Could not confirm the save. Retry with the same values.'
