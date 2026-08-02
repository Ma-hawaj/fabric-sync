import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { Invoice } from '../types/invoices'

async function fetchInvoices(): Promise<Invoice[]> {
  const { data } = await apiClient.get<Invoice[]>('/invoices')
  return data
}

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: fetchInvoices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
