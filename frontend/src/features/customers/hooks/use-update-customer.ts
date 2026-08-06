import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Customer } from '../types/customers'

export interface UpdateCustomerInput {
  id: string
  marketingOptIn?: boolean
}

async function updateCustomer({
  id,
  ...changes
}: UpdateCustomerInput): Promise<Customer> {
  const { data } = await apiClient.patch<Customer>(`/customers/${id}`, changes)
  return data
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateCustomer,
    onSuccess: (customer) => {
      queryClient.setQueryData<Customer[]>(['customers'], (customers = []) =>
        customers.map((entry) => (entry.id === customer.id ? customer : entry)),
      )
    },
  })
}
