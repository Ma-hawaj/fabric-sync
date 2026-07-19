import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Customer } from '../types/customers'

async function fetchCustomers(): Promise<Customer[]> {
  const response = await fetch(`${apiBaseUrl}/customers`)
  if (!response.ok) {
    throw new Error(`Failed to load customers (${response.status})`)
  }
  return response.json()
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
