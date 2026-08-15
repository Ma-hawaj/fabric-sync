import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    locations: [],
  },
  {
    id: 'mat-2',
    name: 'Wool Blend — Grey',
    sku: null,
    unit: 'meters',
    locations: [],
  },
]

function renderPage() {
  const client = new QueryClient()
  // Seed the cache so useInventory serves data without fetching (its
  // staleTime keeps the seeded data fresh for the whole test).
  client.setQueryData(['materials'], MATERIALS)
  client.setQueryData(['locations'], [])
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
    expect(
      screen.queryByRole('option', {
        name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
      }),
    ).toBeNull()
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
    expect(
      screen.queryByRole('option', { name: 'Wool Blend — Grey' }),
    ).toBeNull()
  })
})
