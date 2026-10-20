import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MaterialPricesForm } from './material-prices-form'
import type { Material } from '../types/inventory'

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiClient: { patch } }))
const material: Material = {
  id: 'm1',
  name: 'Cotton',
  sku: null,
  unit: 'meters',
  family: null,
  locations: [],
  juniorPrice: 10,
  normalPrice: 20,
  largePrice: 30,
}

function renderForm() {
  const client = new QueryClient()
  patch.mockReset()
  patch.mockResolvedValue({ data: material })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MaterialPricesForm material={material} />
    </QueryClientProvider>,
  )
  return invalidate
}

describe('material prices form', () => {
  it('saves all three prices through the material endpoint and refreshes pricing caches', async () => {
    const invalidate = renderForm()
    fireEvent.change(screen.getByLabelText('Normal price'), {
      target: { value: '25.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save prices' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/materials/m1', {
        juniorPrice: 10,
        normalPrice: 25.5,
        largePrice: 30,
      }),
    )
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['materials'] }),
    )
  })
  it('blocks negative prices before writing to the catalog', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Junior price'), {
      target: { value: '-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save prices' }))
    await screen.findByText(
      'Enter a nonnegative amount with at most two decimal places.',
    )
    expect(patch).not.toHaveBeenCalled()
  })
})
