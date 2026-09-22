import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { OrderBlock } from './order-block'
import { createEmptyCustomer } from '../../types/invoice-form'
import type { Material } from '../../types/materials'
import { apiGetMock } from '@/lib/list-fixtures'
import { CURRENCY } from '@/lib/currency'

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

function Harness() {
  const form = useForm({
    defaultValues: { customers: [createEmptyCustomer()] },
  })
  apiGet.mockImplementation(apiGetMock({ '/materials': MATERIALS }))
  const client = new QueryClient()
  return (
    <QueryClientProvider client={client}>
      <OrderBlock
        form={form as never}
        customerIndex={0}
        orderIndex={0}
        orderNumber={1}
        removable={false}
        onRemove={() => {}}
      />
    </QueryClientProvider>
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

function locationSearchInput() {
  return screen.getByPlaceholderText<HTMLInputElement>('Search location...')
}

function openLocationSearch() {
  const input = locationSearchInput()
  fireEvent.pointerDown(input)
  fireEvent.mouseDown(input)
  fireEvent.click(input)
}

async function pickMaterial(name: RegExp | string) {
  openMaterialSearch()
  const option = await screen.findByRole('option', { name })
  fireEvent.click(option)
}

describe('OrderBlock', () => {
  it('lists fetched materials with their SKU when present', async () => {
    render(<Harness />)

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
    render(<Harness />)

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

  it("shows the material's stock across locations once selected", async () => {
    render(<Harness />)

    await pickMaterial('Cotton Poplin — White (FB-CTN-WHT-01)')

    expect(
      await screen.findByText(
        'Available: 120 meters — Main Warehouse: 100, Downtown Branch: 20',
      ),
    ).toBeTruthy()
  })

  it("limits the Made At picker to the selected material's stock locations", async () => {
    render(<Harness />)

    await pickMaterial('Cotton Poplin — White (FB-CTN-WHT-01)')
    openLocationSearch()

    expect(
      await screen.findByRole('option', {
        name: 'Main Warehouse (100 meters)',
      }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('option', {
        name: 'Downtown Branch (20 meters)',
      }),
    ).toBeTruthy()
  })

  it('hints when the selected material has no stock anywhere', async () => {
    render(<Harness />)

    await pickMaterial('Wool Blend — Grey')
    openLocationSearch()

    expect(
      await screen.findByText('This material has no stock available.'),
    ).toBeTruthy()
  })

  it('has a manual price field for the order line', () => {
    render(<Harness />)
    expect(screen.getByLabelText(`Price (${CURRENCY})`)).toBeTruthy()
  })
})
