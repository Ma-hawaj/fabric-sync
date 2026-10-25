import { CURRENCY } from '@/lib/currency'
import { ApiError } from '@/lib/api'

export const money = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
  }).format(amount)
export const failureMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.status === 409
      ? 'This operation may already be recorded. Refresh the history before trying again.'
      : error.message
    : 'Could not confirm the save. Retry with the same values.'
