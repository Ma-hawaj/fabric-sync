import { useListQuery } from '@/hooks/use-list-query'
import type { RepairListItem } from '../types/orders'

export function useRepairs(searchParams: URLSearchParams) {
  return useListQuery<RepairListItem>({
    endpoint: '/repairs',
    queryKey: 'repairs',
    searchParams,
  })
}
