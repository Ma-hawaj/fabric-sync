import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Customer } from '../types/customers'
import type { CustomerMarketingPreference } from '../types/customer-form'

// PATCH accepts any subset of the fields, so this serves the edit form
// and any future single-field action.
export interface UpdateCustomerInput {
  id: string
  name?: string
  mobileNo?: string
  whatsappNotificationsEnabled?: boolean
  marketingPreference?: CustomerMarketingPreference
  address?: string
}

async function updateCustomer({
  id,
  ...changes
}: UpdateCustomerInput): Promise<Customer> {
  const response = await apiClient.patch<Customer>(`/customers/${id}`, changes)

  return response.data
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateCustomer,
    onSuccess: () => {
      // The cache holds one entry per page-and-filter combination now, and
      // each holds an envelope rather than a bare array, so there is no
      // single list to splice into. Prefix matching refreshes them all.
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['marketing-consent'] })
      void queryClient.invalidateQueries({
        queryKey: ['campaign-audience-count'],
      })
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}
