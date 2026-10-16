import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { RepairListItem } from '../types/orders'

async function fetchRepairs(): Promise<RepairListItem[]> {
  const { data } = await apiClient.get<RepairListItem[]>('/repairs')
  return data
}

// The global Repairs page. Flat rows (repair + order context) from the
// backend, filtered client-side — the same unparameterized-key pattern the
// other lists use, so setQueryData-based tests stay simple.
export function useRepairs() {
  return useQuery({
    queryKey: ['repairs'],
    queryFn: fetchRepairs,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
