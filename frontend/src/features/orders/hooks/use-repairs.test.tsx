import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { apiClient } from '@/lib/api'
import { useRepairs } from './use-repairs'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))

describe('useRepairs', () => {
  it('requests and caches each server page with its filters and totals', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const get = vi.mocked(apiClient.get)
    get.mockImplementation(async (url) => {
      const page = Number(
        new URL(String(url), 'http://localhost').searchParams.get('page'),
      )
      return {
        data: {
          data: [{ id: `repair-${page}` }],
          page,
          perPage: 1,
          total: 2,
          pageCount: 2,
        },
      }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const params = (page: number) =>
      new URLSearchParams({
        page: String(page),
        perPage: '1',
        filters: JSON.stringify([
          {
            id: 'status',
            value: ['open'],
            variant: 'multiSelect',
            operator: 'inArray',
          },
        ]),
        sort: JSON.stringify([{ id: 'reportedOn', desc: true }]),
      })
    const { result, rerender, unmount } = renderHook(
      ({ page }) => useRepairs(params(page)),
      { wrapper, initialProps: { page: 1 } },
    )
    await waitFor(() => expect(result.current.data[0]?.id).toBe('repair-1'))
    expect(result.current.total).toBe(2)
    expect(result.current.pageCount).toBe(2)
    rerender({ page: 2 })
    await waitFor(() => expect(result.current.data[0]?.id).toBe('repair-2'))
    expect(get).toHaveBeenCalledWith(`/repairs?${params(2).toString()}`)
    rerender({ page: 1 })
    await waitFor(() => expect(result.current.data[0]?.id).toBe('repair-1'))
    expect(get).toHaveBeenCalledTimes(2)
    unmount()
    client.clear()
  })
})
