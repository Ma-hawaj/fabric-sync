import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiGetMock } from '@/lib/list-fixtures'
import { typeSearchText } from '@/lib/test-events'
import { AddStockDialog } from './add-stock-dialog'
import type { Material } from '../types/inventory'

const MATERIALS: Material[] = [
  {
    id: 'mat-1',
    name: 'Cotton Poplin — White',
    sku: 'FB-CTN-WHT-01',
    unit: 'meters',
    juniorPrice: 10,
    normalPrice: 20,
    largePrice: 30,
    family: 'Cotton Poplin',
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
    juniorPrice: 10,
    normalPrice: 20,
    largePrice: 30,
    family: 'Wool Blend',
    locations: [],
  },
]

// The material picker queries the server per keystroke, so the API layer is
// mocked to serve the search against in-memory rows instead of hitting the
// network in jsdom.
const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet, post: apiPost },
  ApiError: class ApiError extends Error {},
}))

function renderDialog(material?: Material) {
  const onOpenChange = vi.fn()
  apiPost.mockReset().mockResolvedValue({ data: MATERIALS[0] })
  apiGet.mockClear().mockImplementation(
    apiGetMock({
      '/materials': MATERIALS,
      '/locations': [
        {
          id: 'loc-1',
          name: 'Main Warehouse',
          isActive: true,
          holdsStock: true,
          receivesOrders: false,
        },
      ],
    }),
  )
  const client = new QueryClient()
  if (material) {
    client.setQueryData(['default-location'], {
      defaultLocationId: 'loc-1',
      defaultLocation: {
        id: 'loc-1',
        name: 'Main Warehouse',
        isActive: true,
        holdsStock: true,
        receivesOrders: false,
      },
    })
  }
  render(
    <QueryClientProvider client={client}>
      <AddStockDialog open material={material} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
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

describe('AddStockDialog', () => {
  async function fillStock() {
    openMaterialSearch()
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'Cotton Poplin — White (FB-CTN-WHT-01)',
      }),
    )
    await fillLocationAndQuantity()
  }

  async function fillLocationAndQuantity() {
    const location = screen.getByPlaceholderText('Search location...')
    fireEvent.pointerDown(location)
    fireEvent.mouseDown(location)
    fireEvent.click(location)
    fireEvent.click(
      await screen.findByRole('option', { name: 'Main Warehouse' }),
    )
    fireEvent.change(screen.getByLabelText('Quantity'), {
      target: { value: '5.25' },
    })
  }

  it.each(MATERIALS)(
    'adds stock directly to $name without searching, including materials with no stock',
    async (material) => {
      const { onOpenChange } = renderDialog(material)
      expect(
        screen.getByText(
          `Add stock for ${material.sku ? `${material.name} (${material.sku})` : material.name} across one or more locations.`,
        ),
      ).toBeTruthy()
      expect(
        screen.queryByPlaceholderText('Search material by name or SKU...'),
      ).toBeNull()
      expect(screen.queryByRole('radio', { name: 'New Material' })).toBeNull()
      await waitFor(() =>
        expect(
          screen.getByPlaceholderText<HTMLInputElement>('Search location...')
            .value,
        ).toBe('Main Warehouse'),
      )
      fireEvent.change(screen.getByLabelText('Quantity'), {
        target: { value: '5.25' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith(
          `/materials/${material.id}/stock`,
          {
            entries: [{ locationId: 'loc-1', quantity: 5.25 }],
          },
        ),
      )
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(apiGet.mock.calls.some(([path]) => path === '/materials')).toBe(
        false,
      )
    },
  )

  it('saves existing stock and closes the dialog without navigating away', async () => {
    const { onOpenChange } = renderDialog()
    await fillStock()
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/materials/mat-1/stock', {
        entries: [{ locationId: 'loc-1', quantity: 5.25 }],
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('preserves the entered stock and stays open when saving fails', async () => {
    const { onOpenChange } = renderDialog()
    apiPost.mockRejectedValue(new Error('Offline'))
    await fillStock()
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Save', exact: true })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(screen.getByLabelText<HTMLInputElement>('Quantity').value).toBe(
      '5.25',
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('includes new material details and prices in the same dialog', () => {
    const { onOpenChange } = renderDialog()
    fireEvent.click(
      screen.getByRole('radio', { name: 'New Material', exact: true }),
    )
    for (const label of [
      'Name',
      'SKU',
      'Family',
      'Unit',
      'Junior price incl. VAT',
      'Normal price incl. VAT',
      'Large price incl. VAT',
    ])
      expect(screen.getByLabelText(label)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lists materials with their SKU when present', async () => {
    renderDialog()

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
    renderDialog()

    openMaterialSearch()
    typeSearchText(searchInput(), 'Wool')

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
    renderDialog()

    openMaterialSearch()
    typeSearchText(searchInput(), 'FB-CTN')

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
