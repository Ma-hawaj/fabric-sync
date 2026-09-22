import { useListQuery } from '@/hooks/use-list-query'
import type { Invoice } from '../types/invoices'

export function useInvoices(searchParams: URLSearchParams) {
  return useListQuery<Invoice>({
    endpoint: '/invoices',
    queryKey: 'invoices',
    searchParams,
  })
}
