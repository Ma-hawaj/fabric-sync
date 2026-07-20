import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Invoice } from '../types/invoices'

async function fetchInvoices(): Promise<Invoice[]> {
  const response = await fetch(`${apiBaseUrl}/invoices`)
  if (!response.ok) {
    throw new Error(`Failed to load invoices (${response.status})`)
  }
  return response.json()
}

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: fetchInvoices,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
