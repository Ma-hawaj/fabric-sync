import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiGetMock } from '@/lib/list-fixtures'
import { InventoryFormPage } from './inventory-form'
import type { Material } from './types/inventory'

// Hoisted by vitest above these imports at transform time.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const MATERIALS: Material[] = [
  {
    id: 'mat-1',
    name: 'Cotton Poplin — White',
    sku: 'FB-CTN-WHT-01',
    unit: 'meters',
    locations: [
      { locationId: 'loc-1', location: 'Main Warehouse', quantity: 100 },
      { locationId: 'loc-2', location: 'Downtown Branch', quantity: 20 },
    ],
  },
  {
    id: 'mat-2',
    name: 'Wool Blend — Grey',
    sku: null,
    unit: 'meters',
    locations: [],
  },
]

// The material picker queries the server per keystroke, so the API layer is
// mocked to serve the search against in-memory rows instead of hitting the
// network in jsdom.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function renderPage() {
  apiGet.mockImplementation(
    apiGetMock({
      '/materials': MATERIALS,
      '/locations': [],
    }),
  )
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <InventoryFormPage />
    </QueryClientProvider>,
  )
}

function searchInput() {
  return screen.getByPlaceholderText<HTMLInputElement>(
    'Search material by name or SKU...',
  )
}

// Base UI's Combobox only opens its popup for a click preceded by real
// pointer/mouse events; fireEvent.click alone looks synthetic and is ignored.
function openMaterialSearch() {
  const input = searchInput()
  fireEvent.pointerDown(input)
  fireEvent.mouseDown(input)
  fireEvent.click(input)
}

describe('InventoryFormPage material search', () => {
  it('lists materials with their SKU when present', async () => {
    renderPage()

    openMaterialSearch()
    expect(
      await screen.findByRole('option', {
        name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
      }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('option', { name: 'Wool Blend — Grey' }),
    ).toBeTruthy()
  })

  it('filters the material list by the typed search text', async () => {
    renderPage()

    openMaterialSearch()
    fireEvent.change(searchInput(), { target: { value: 'Wool' } })

    expect(
      await screen.findByRole('option', { name: 'Wool Blend — Grey' }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.queryByRole('option', {
          name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
        }),
      ).toBeNull(),
    )
  })

  it('matches on the SKU as well as the name', async () => {
    renderPage()

    openMaterialSearch()
    fireEvent.change(searchInput(), { target: { value: 'FB-CTN' } })

    expect(
      await screen.findByRole('option', {
        name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
      }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.queryByRole('option', { name: 'Wool Blend — Grey' }),
      ).toBeNull(),
    )
  })
})
