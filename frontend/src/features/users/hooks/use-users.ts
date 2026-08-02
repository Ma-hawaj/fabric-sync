import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { User } from '../types/user'

async function fetchUsers(): Promise<User[]> {
  const { data } = await apiClient.get<User[]>('/users')
  return data
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 1000 * 60 * 5,
  })
}
