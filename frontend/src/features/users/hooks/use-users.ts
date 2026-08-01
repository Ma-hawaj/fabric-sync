import { useQuery } from '@tanstack/react-query'
import { apiBaseUrl } from '@/lib/api'
import type { User } from '../types/user'

async function fetchUsers(): Promise<User[]> {
  const response = await fetch(`${apiBaseUrl}/users`)
  if (!response.ok) {
    throw new Error(`Failed to load users (${response.status})`)
  }
  return response.json()
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 1000 * 60 * 5,
  })
}
