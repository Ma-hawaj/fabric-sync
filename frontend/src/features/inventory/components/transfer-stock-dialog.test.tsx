import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TransferStockDialog } from './transfer-stock-dialog'
import type { Material } from '../types/inventory'
import type { Location } from '@/features/locations/types/location'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { post },
  ApiError: class ApiError extends Error {},
}))
const material: Material = {
  id: 'm1',
  name: 'Cotton',
  sku: null,
  family: null,
  unit: 'meters',
  juniorPrice: 10,
  normalPrice: 20,
  largePrice: 30,
  locations: [{ locationId: 'a', location: 'Warehouse', quantity: 10 }],
}
const locations: Location[] = [
  {
    id: 'a',
    name: 'Warehouse',
    isActive: true,
    holdsStock: true,
    receivesOrders: false,
  },
  {
    id: 'b',
    name: 'Workshop',
    isActive: true,
    holdsStock: true,
    receivesOrders: false,
  },
  {
    id: 'c',
    name: 'Retired',
    isActive: false,
    holdsStock: true,
    receivesOrders: false,
  },
  {
    id: 'd',
    name: 'Pickup Only',
    isActive: true,
    holdsStock: false,
    receivesOrders: true,
  },
]
function renderDialog() {
  post.mockReset().mockResolvedValue({ data: material })
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const close = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <TransferStockDialog
        material={material}
        locations={locations}
        onOpenChange={close}
      />
    </QueryClientProvider>,
  )
  return { close, invalidate }
}
async function chooseDestination() {
  fireEvent.click(screen.getByRole('combobox', { name: 'To location' }))
  expect(screen.queryByRole('option', { name: 'Retired' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Pickup Only' })).toBeNull()
  expect(screen.queryByRole('option', { name: /Warehouse/ })).toBeNull()
  fireEvent.click(await screen.findByRole('option', { name: 'Workshop' }))
}
describe('move stock dialog', () => {
  it('moves stock once and refreshes material and order availability', async () => {
    const { close, invalidate } = renderDialog()
    await chooseDestination()
    fireEvent.change(screen.getByLabelText('Quantity to move'), {
      target: { value: '3.25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move Stock' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/materials/m1/stock/transfer', {
        fromLocationId: 'a',
        toLocationId: 'b',
        quantity: 3.25,
      }),
    )
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['materials'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
  })
  it('blocks an excessive quantity before sending the request', async () => {
    renderDialog()
    await chooseDestination()
    fireEvent.change(screen.getByLabelText('Quantity to move'), {
      target: { value: '11' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move Stock' }))
    await screen.findByText('This is more than the available stock.')
    expect(post).not.toHaveBeenCalled()
  })
  it('keeps the dialog open when the server refuses a stale stock balance', async () => {
    const { close } = renderDialog()
    post.mockRejectedValue(new Error('stock changed'))
    await chooseDestination()
    fireEvent.change(screen.getByLabelText('Quantity to move'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move Stock' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Move Stock' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(close).not.toHaveBeenCalled()
  })
})
