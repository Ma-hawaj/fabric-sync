import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { CustomerFormValues } from '../types/customer-form'
import type { Customer } from '../types/customers'

async function createCustomer(values: CustomerFormValues): Promise<Customer> {
  const response = await fetch(`${apiBaseUrl}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  })
  if (!response.ok) {
    throw new Error(`Failed to create customer (${response.status})`)
  }
  return response.json()
}

export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createCustomer,
    onSuccess: (customer) => {
      queryClient.setQueryData<Customer[]>(['customers'], (customers = []) => [
        ...customers,
        customer,
      ])
    },
  })
}
