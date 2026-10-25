import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiGetMock } from '@/lib/list-fixtures'
import { MaterialBlock } from './material-block'
import {
  createEmptyInvoiceForm,
  createEmptyMaterialLine,
} from '../../types/invoice-form'
import type { InvoiceMaterialDraft } from '../../types/invoice-form'
import type { Material } from '../../types/materials'

const MATERIALS: Material[] = [
  {
    id: 'linen',
    name: 'Linen',
    sku: null,
    family: null,
    unit: 'meters',
    juniorPrice: null,
    normalPrice: null,
    largePrice: null,
    locations: [
      { locationId: 'stock-1', location: 'Linen Store', quantity: 8 },
      { locationId: 'empty-stock', location: 'Empty Store', quantity: 0 },
    ],
  },
  {
    id: 'cotton',
    name: 'Cotton',
    sku: null,
    family: null,
    unit: 'meters',
    juniorPrice: null,
    normalPrice: null,
    largePrice: null,
    locations: [
      { locationId: 'stock-2', location: 'Cotton Store', quantity: 5 },
    ],
  },
  {
    id: 'empty',
    name: 'Empty Fabric',
    sku: null,
    family: null,
    unit: 'meters',
    juniorPrice: null,
    normalPrice: null,
    largePrice: null,
    locations: [],
  },
]
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function Harness({
  line = {},
  defaultLocationId = null,
}: {
  line?: Partial<InvoiceMaterialDraft>
  defaultLocationId?: string | null
}) {
  const form = useForm({
    defaultValues: {
      ...createEmptyInvoiceForm(),
      customers: [],
      materials: [{ ...createEmptyMaterialLine(), ...line }],
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const stock = MATERIALS.flatMap((material) => material.locations).find(
    (location) => location.locationId === defaultLocationId,
  )
  client.setQueryData(['default-location'], {
    defaultLocationId,
    defaultLocation: stock
      ? {
          id: stock.locationId,
          name: stock.location,
          isActive: true,
          holdsStock: true,
          receivesOrders: false,
        }
      : null,
  })
  apiGet.mockImplementation(apiGetMock({ '/materials': MATERIALS }))
  return (
    <QueryClientProvider client={client}>
      <MaterialBlock
        form={form as never}
        lineIndex={0}
        onMaterialPicked={vi.fn()}
        initialMaterialForId={(id) =>
          MATERIALS.find((material) => material.id === id) ?? null
        }
        materialLabelForId={(id) =>
          MATERIALS.find((material) => material.id === id)?.name ?? null
        }
        onRemove={vi.fn()}
      />
      <form.Subscribe selector={(state) => state.values.materials[0]}>
        {(value) => <output data-testid="line">{JSON.stringify(value)}</output>}
      </form.Subscribe>
    </QueryClientProvider>
  )
}
function openInput(label: string) {
  const input = screen.getByLabelText(label)
  fireEvent.pointerDown(input)
  fireEvent.mouseDown(input)
  fireEvent.click(input)
}
function draft() {
  return JSON.parse(
    screen.getByTestId('line').textContent,
  ) as InvoiceMaterialDraft
}
async function pickMaterial(name: string) {
  openInput('Material')
  fireEvent.click(await screen.findByRole('option', { name }))
}

describe('MaterialBlock stock locations', () => {
  it('lists only the picked material’s available stock locations without requesting /locations', async () => {
    render(<Harness />)
    await pickMaterial('Linen')
    openInput('Sold From')
    fireEvent.click(
      await screen.findByRole('option', { name: 'Linen Store — 8 meters' }),
    )
    await waitFor(() => expect(draft().branchId).toBe('stock-1'))
    openInput('Sold From')
    expect(
      screen.queryByRole('option', { name: /Cotton Store|Empty Store/ }),
    ).toBeNull()
    expect(
      apiGet.mock.calls.every(([url]) => !String(url).startsWith('/locations')),
    ).toBe(true)
  })
  it('clears the sold-from location when the material changes', async () => {
    render(<Harness line={{ materialId: 'linen', branchId: 'stock-1' }} />)
    await pickMaterial('Cotton')
    await waitFor(() =>
      expect(draft()).toMatchObject({ materialId: 'cotton', branchId: '' }),
    )
    openInput('Sold From')
    expect(
      await screen.findByRole('option', { name: 'Cotton Store — 5 meters' }),
    ).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Linen Store/ })).toBeNull()
  })
  it('applies the default only when the chosen material is stocked there', async () => {
    render(<Harness defaultLocationId="stock-2" />)
    await pickMaterial('Linen')
    expect(draft().branchId).toBe('')
    await pickMaterial('Cotton')
    await waitFor(() => expect(draft().branchId).toBe('stock-2'))
  })
  it('shows an empty message for a material with no stock', async () => {
    render(<Harness />)
    await pickMaterial('Empty Fabric')
    openInput('Sold From')
    expect(
      await screen.findByText('This material has no stock available.'),
    ).toBeTruthy()
    expect(screen.queryByRole('option')).toBeNull()
  })
  it('keeps the saved location visible when an edited sale exhausted its stock', () => {
    render(<Harness line={{ materialId: 'linen', branchId: 'empty-stock' }} />)
    expect(screen.getByLabelText<HTMLInputElement>('Sold From').value).toBe(
      'Empty Store — 0 meters',
    )
    expect(draft().branchId).toBe('empty-stock')
  })
})
