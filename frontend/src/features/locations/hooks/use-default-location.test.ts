import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Location } from '../types/location'
import type { Preferences } from './use-default-location'
import { useApplicableDefaultLocation } from './use-default-location'

// The unset-preferences case would otherwise hit the network; without a live
// backend the query stays pending and reads as null either way.
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiClient: {
    get: vi.fn().mockRejectedValue(new Error('no backend in tests')),
    put: vi.fn(),
  },
}))

const BOTH: Location = {
  id: 'loc-1',
  name: 'Manama Main Branch',
  receivesOrders: true,
  holdsStock: true,
  isActive: true,
}

function wrapper(preferences: Preferences | undefined) {
  const client = new QueryClient()
  if (preferences) {
    client.setQueryData(['default-location'], preferences)
  }
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

function preferencesFor(location: Location | null): Preferences {
  return {
    defaultLocationId: location?.id ?? null,
    defaultLocation: location,
  }
}

describe('useApplicableDefaultLocation', () => {
  it('applies a both-capable default to either picker', () => {
    const receiving = renderHook(
      () => useApplicableDefaultLocation('receiving'),
      {
        wrapper: wrapper(preferencesFor(BOTH)),
      },
    )
    const stock = renderHook(() => useApplicableDefaultLocation('stock'), {
      wrapper: wrapper(preferencesFor(BOTH)),
    })

    expect(receiving.result.current?.id).toBe('loc-1')
    expect(stock.result.current?.id).toBe('loc-1')
  })

  it('keeps a branch-only default out of stock pickers', () => {
    const branchOnly = { ...BOTH, holdsStock: false }
    const receiving = renderHook(
      () => useApplicableDefaultLocation('receiving'),
      {
        wrapper: wrapper(preferencesFor(branchOnly)),
      },
    )
    const stock = renderHook(() => useApplicableDefaultLocation('stock'), {
      wrapper: wrapper(preferencesFor(branchOnly)),
    })

    expect(receiving.result.current?.id).toBe('loc-1')
    expect(stock.result.current).toBeNull()
  })

  it('keeps a store-only default out of receiving pickers', () => {
    const storeOnly = { ...BOTH, receivesOrders: false }
    const receiving = renderHook(
      () => useApplicableDefaultLocation('receiving'),
      {
        wrapper: wrapper(preferencesFor(storeOnly)),
      },
    )
    const stock = renderHook(() => useApplicableDefaultLocation('stock'), {
      wrapper: wrapper(preferencesFor(storeOnly)),
    })

    expect(receiving.result.current).toBeNull()
    expect(stock.result.current?.id).toBe('loc-1')
  })

  it('applies a deactivated default nowhere', () => {
    const inactive = { ...BOTH, isActive: false }
    const receiving = renderHook(
      () => useApplicableDefaultLocation('receiving'),
      {
        wrapper: wrapper(preferencesFor(inactive)),
      },
    )
    const stock = renderHook(() => useApplicableDefaultLocation('stock'), {
      wrapper: wrapper(preferencesFor(inactive)),
    })

    expect(receiving.result.current).toBeNull()
    expect(stock.result.current).toBeNull()
  })

  it('returns null while preferences are unset', () => {
    const { result } = renderHook(
      () => useApplicableDefaultLocation('receiving'),
      { wrapper: wrapper(undefined) },
    )

    expect(result.current).toBeNull()
  })
})
