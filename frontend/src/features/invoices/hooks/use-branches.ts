import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { Branch } from '../types/branches'

async function fetchBranches(): Promise<Branch[]> {
  const response = await fetch(`${apiBaseUrl}/locations`)
  if (!response.ok) {
    throw new Error(`Failed to load branches (${response.status})`)
  }
  return response.json()
}

export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: fetchBranches,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
