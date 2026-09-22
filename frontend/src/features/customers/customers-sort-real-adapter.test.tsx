import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  parseSearchWith,
  Outlet,
} from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import * as React from 'react'

import { CustomersPage } from '@/features/customers/customers'
import type { Customer } from '@/features/customers/types/customers'
import { listResponse } from '@/lib/list-fixtures'

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

const CUSTOMERS: Customer[] = [
  {
    id: 'c-1',
    name: 'Zainab',
    mobileNo: '456',
    measurements: [],
  },
  {
    id: 'c-2',
    name: 'Aamal',
    mobileNo: '123',
    measurements: [],
  },
]

function sorted() {
  return [...CUSTOMERS].sort((a, b) => a.name.localeCompare(b.name))
}

type RouterContext = {
  queryClient: QueryClient
}

function makeRouter(client: QueryClient) {
  const root = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <NuqsAdapter>
        <Outlet />
      </NuqsAdapter>
    ),
  })
  const customersRoute = createRoute({
    getParentRoute: () => root,
    path: '/customers',
    component: CustomersPage,
  })
  const routeTree = root.addChildren([customersRoute])
  // Router-level search must NOT JSON-decode: nuqs owns these URLs and
  // round-trips raw strings itself. The default `parseSearch` turns a `sort`
  // value into a real array of objects, which the nuqs tanstack-router adapter
  // re-serializes as `[object Object]`, dropping the sort on reconcile.
  return createRouter({
    routeTree,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: ['/customers'] }),
    parseSearch: parseSearchWith((value: string) => value),
  })
}

function rowOrder() {
  const zainab = screen.queryAllByText('Zainab').map((el) => el.closest('tr'))
  const aamal = screen.queryAllByText('Aamal').map((el) => el.closest('tr'))
  if (!zainab[0] || !aamal[0]) return undefined
  return (aamal[0].compareDocumentPosition(zainab[0]) &
    Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
    ? ['Aamal', 'Zainab']
    : ['Zainab', 'Aamal']
}

describe('customers page sorting (real tanstack-router adapter)', () => {
  it('refetches with the sort param and renders the sorted rows after one click', async () => {
    const client = new QueryClient()
    apiGet.mockImplementation(async (url: string) => {
      if (url.includes('sort=')) return { data: listResponse(sorted()) }
      return { data: listResponse(CUSTOMERS) }
    })

    const router = makeRouter(client)

    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} context={{ queryClient: client }} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Aamal')).toBeTruthy()
    expect(screen.getByText('Zainab')).toBeTruthy()
    expect(rowOrder()).toEqual(['Zainab', 'Aamal'])

    const nameHeader = screen.getByText('Name').closest('button')
    expect(nameHeader).toBeTruthy()
    fireEvent.pointerDown(nameHeader)
    fireEvent.mouseDown(nameHeader)
    const asc = await screen.findByText('Asc')
    fireEvent.pointerDown(asc)
    fireEvent.mouseDown(asc)
    fireEvent.click(asc)

    await waitFor(() => {
      const calls = apiGet.mock.calls as string[][]
      const sortedCalls = calls.filter(([url]) => url.includes('sort='))
      expect(sortedCalls.length).toBeGreaterThan(0)
    })

    await waitFor(() => {
      expect(rowOrder()).toEqual(['Aamal', 'Zainab'])
    })
  })
})
