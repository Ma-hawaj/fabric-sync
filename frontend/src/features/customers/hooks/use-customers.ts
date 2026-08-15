import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Customer } from '../types/customers'

async function fetchCustomers(): Promise<Customer[]> {
  const { data } = await apiClient.get<Customer[]>('/customers')
  return data
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
