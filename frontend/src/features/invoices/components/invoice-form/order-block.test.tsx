import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { OrderBlock } from './order-block'
import { createEmptyCustomer } from '../../types/invoice-form'
import type { InvoiceOrderDraft } from '../../types/invoice-form'
import type { Material } from '../../types/materials'
import { apiGetMock } from '@/lib/list-fixtures'
import { typeSearchText } from '@/lib/test-events'
import { CURRENCY } from '@/lib/currency'

const MATERIALS: Material[] = [
  {
    id: 'mat-1',
    name: 'Cotton Poplin — White',
    sku: 'FB-CTN-WHT-01',
    unit: 'meters',
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
    family: 'Wool Blend',
    locations: [],
  },
]

const DESIGN_OPTIONS = [
  {
    id: 'emd-6',
    category: 'emd',
    slug: '6',
    label: '6',
    sortOrder: 6,
    isActive: true,
    hasImage: false,
    imageUrl: '/design-options/emd-6/image?v=1',
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

function Harness({
  order = {},
  isUrgent = false,
}: { order?: Partial<InvoiceOrderDraft>; isUrgent?: boolean } = {}) {
  const form = useForm({
    defaultValues: {
      isUrgent,
      customers: [
        {
          ...createEmptyCustomer(),
          orders: [{ ...createEmptyCustomer().orders[0], ...order }],
        },
      ],
    },
  })
  apiGet.mockImplementation(
    apiGetMock({
      '/materials': MATERIALS,
      '/locations': [
        {
          id: 'workshop',
          name: 'Customer Fabric Workshop',
          receivesOrders: false,
          holdsStock: true,
          isActive: true,
        },
      ],
      '/design-options': DESIGN_OPTIONS,
    }),
  )
  const client = new QueryClient()
  return (
    <QueryClientProvider client={client}>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <output data-testid="draft">{JSON.stringify(values)}</output>
        )}
      </form.Subscribe>
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
  it('edits the urgent charge on the order itself', () => {
    render(<Harness isUrgent order={{ urgentCharge: 10 }} />)
    const field = screen.getByLabelText(`Urgent charge incl. VAT (${CURRENCY})`)
    fireEvent.change(field, { target: { value: '15' } })
    fireEvent.blur(field)
    expect(
      JSON.parse(screen.getByTestId('draft').textContent).customers[0].orders[0]
        .urgentCharge,
    ).toBe(15)
  })

  it('creates a customer fabric order with a production location that has no inventory stock', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: 'Customer' }))
    expect(
      screen.queryByPlaceholderText('Search material by name or SKU...'),
    ).toBeNull()
    fireEvent.change(screen.getByLabelText('Customer fabric description'), {
      target: { value: 'White linen' },
    })
    const input = screen.getByPlaceholderText('Search production location...')
    fireEvent.pointerDown(input)
    fireEvent.mouseDown(input)
    fireEvent.click(input)
    fireEvent.click(
      await screen.findByRole('option', { name: 'Customer Fabric Workshop' }),
    )
    await waitFor(() => {
      const draft = JSON.parse(screen.getByTestId('draft').textContent)
      expect(draft.customers[0].orders[0]).toMatchObject({
        materialSource: 'customer',
        materialId: '',
        customerMaterialDescription: 'White linen',
        productionLocationId: 'workshop',
      })
    })
    expect(screen.queryByText(/Available:/)).toBeNull()
  })

  it('clears incompatible fabric and location fields when changing material source', async () => {
    render(
      <Harness
        order={{
          materialId: 'mat-1',
          productionLocationId: 'loc-1',
          materialAmount: 3,
          price: 40,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Customer' }))
    fireEvent.change(screen.getByLabelText('Customer fabric description'), {
      target: { value: 'Customer linen' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Shop' }))
    await waitFor(() => {
      const order = JSON.parse(screen.getByTestId('draft').textContent)
        .customers[0].orders[0]
      expect(order).toMatchObject({
        materialSource: 'shop',
        materialId: '',
        customerMaterialDescription: '',
        productionLocationId: '',
        materialAmount: 3,
        price: 40,
      })
    })
  })

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

  it('keeps the material search text editable after a material is selected', async () => {
    render(<Harness />)

    await pickMaterial('Cotton Poplin — White (FB-CTN-WHT-01)')
    const input = searchInput()
    typeSearchText(input, 'Wool')

    expect(input.value).toBe('Wool')
    await waitFor(() => {
      const order = JSON.parse(screen.getByTestId('draft').textContent)
        .customers[0].orders[0]
      expect(order.materialId).toBe('mat-1')
    })
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
    expect(screen.getByLabelText(`Price incl. VAT (${CURRENCY})`)).toBeTruthy()
  })

  it('lets staff clear a stored EMD value', async () => {
    render(<Harness order={{ emd: '6' }} />)

    const none = await screen.findByRole('radio', { name: 'None' })
    expect((none as HTMLButtonElement).getAttribute('aria-checked')).toBe(
      'false',
    )

    fireEvent.click(none)

    await waitFor(() => {
      const order = JSON.parse(screen.getByTestId('draft').textContent)
        .customers[0].orders[0]
      expect(order.emd).toBe('')
    })
  })
})
