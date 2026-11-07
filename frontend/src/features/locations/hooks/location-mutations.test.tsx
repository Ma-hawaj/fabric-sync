import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
} from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api'
import type { Location } from '../types/location'
import { locationToFormValues } from '../types/location-form'
import { useCreateLocation } from './use-create-location'
import { useUpdateLocation } from './use-update-location'

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const branch: Location = {
  id: 'branch',
  name: 'Main Branch',
  isActive: true,
  holdsStock: true,
  receivesOrders: true,
  producesOrders: true,
}

// Use the consumers' independent cache prefixes rather than the invalidation
// constant, so a missing picker causes the cached data to remain stale.
const pickerKeys = [
  'invoice-issuing-branch',
  'invoice-receiving-branch',
  'invoice-sold-from',
  'invoice-production-branch',
  'production-location-picker',
  'stock-entry-locations',
  'return-restock-locations',
].map((prefix) => [prefix, 'name', 'active-filter', 'search-text', 20])

beforeEach(() => vi.clearAllMocks())

describe('location picker freshness', () => {
  it.each(['create', 'rename', 'deactivate'] as const)(
    'refreshes fresh cached picker results after %s without waiting five minutes',
    async (operation) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
      })
      for (const key of pickerKeys) client.setQueryData(key, [branch])
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(
        () => ({
          create: useCreateLocation(),
          update: useUpdateLocation(),
          pickers: useQueries({
            queries: pickerKeys.map((queryKey) => ({
              queryKey,
              queryFn: async () =>
                (await apiClient.get<Location[]>('/locations')).data,
            })),
          }),
        }),
        { wrapper },
      )
      expect(result.current.pickers.every((picker) => !picker.isStale)).toBe(
        true,
      )
      expect(apiClient.get).not.toHaveBeenCalled()

      const changed = {
        ...branch,
        id: operation === 'create' ? 'new-branch' : branch.id,
        name: 'New Branch',
        isActive: operation !== 'deactivate',
      }
      const available =
        operation === 'create'
          ? [branch, changed]
          : operation === 'deactivate'
            ? []
            : [changed]
      vi.mocked(apiClient.get).mockResolvedValue({ data: available })
      vi.mocked(apiClient.post).mockResolvedValue({ data: changed })
      vi.mocked(apiClient.patch).mockResolvedValue({ data: changed })

      await act(async () => {
        if (operation === 'create') {
          await result.current.create.mutateAsync(locationToFormValues(changed))
        } else {
          await result.current.update.mutateAsync({
            id: branch.id,
            ...(operation === 'deactivate'
              ? { isActive: false }
              : { name: changed.name }),
          })
        }
      })
      await waitFor(() => {
        for (const picker of result.current.pickers) {
          expect(picker.data).toEqual(available)
          expect(picker.isFetching).toBe(false)
        }
      })
    },
  )
})
