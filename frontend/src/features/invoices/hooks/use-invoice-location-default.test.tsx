import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { listResponse } from '@/lib/list-fixtures'
import {
  ISSUING_BRANCH_FILTERS,
  ORDER_RECEIVING_FILTERS,
  STOCK_FILTERS,
  PRODUCTION_FILTERS,
} from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'
import { useInvoiceLocationDefault } from './use-invoice-location-default'

vi.mock('@/lib/api', () => ({
  apiClient: { get: () => new Promise(() => {}) },
}))

const branch: Location = {
  id: 'branch',
  name: 'Branch',
  isActive: true,
  receivesOrders: true,
  holdsStock: false,
  producesOrders: false,
}
const store: Location = {
  id: 'store',
  name: 'Store',
  isActive: true,
  receivesOrders: false,
  holdsStock: true,
  producesOrders: false,
}

function setup(
  kind: 'issuing' | 'receiving' | 'stock' | 'production',
  rows: Location[],
  preferred: Location | null | undefined,
  total = rows.length,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (preferred !== undefined)
    client.setQueryData(['default-location'], {
      defaultLocation: preferred,
      defaultLocationId: preferred?.id ?? null,
    })
  const filters =
    kind === 'issuing'
      ? ISSUING_BRANCH_FILTERS
      : kind === 'receiving'
        ? ORDER_RECEIVING_FILTERS
        : kind === 'production'
          ? PRODUCTION_FILTERS
          : STOCK_FILTERS
  client.setQueryData(
    ['invoice-location-default', 'name', JSON.stringify(filters), '', 2],
    {
      pageParams: [1],
      pages: [{ ...listResponse(rows), total }],
    },
  )
  const result = renderHook(() => useInvoiceLocationDefault(kind), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  return { ...result, client }
}

describe('invoice location defaults', () => {
  it('defaults production to the sole workshop when the user default is a warehouse', () => {
    const workshop = {
      ...store,
      id: 'workshop',
      name: 'Workshop',
      holdsStock: false,
      producesOrders: true,
    }
    expect(setup('production', [workshop], store).result.current?.id).toBe(
      'workshop',
    )
  })
  it('uses the eligible user default even when it is beyond the first page', () => {
    const { result } = setup(
      'issuing',
      [branch, store],
      { ...branch, id: 'preferred' },
      8,
    )
    expect(result.current?.id).toBe('preferred')
  })
  it('selects the only eligible option when there is no default', () => {
    expect(setup('receiving', [branch], null).result.current?.id).toBe('branch')
  })
  it('falls back to the only stock option when the default cannot hold stock', () => {
    expect(setup('stock', [store], branch).result.current?.id).toBe('store')
  })
  it('ignores an inactive default and leaves ambiguous options unselected', () => {
    expect(
      setup('issuing', [branch, store], { ...branch, isActive: false }).result
        .current,
    ).toBeNull()
  })
  it('uses the server total rather than treating a partial page as the only option', () => {
    expect(setup('issuing', [branch], null, 12).result.current).toBeNull()
  })
  it('waits for preferences before choosing a lone option', async () => {
    const { result, client } = setup('issuing', [branch], undefined)
    expect(result.current).toBeNull()
    await act(async () => {
      client.setQueryData(['default-location'], {
        defaultLocation: store,
        defaultLocationId: store.id,
      })
    })
    await waitFor(() => expect(result.current?.id).toBe('store'))
  })
})
