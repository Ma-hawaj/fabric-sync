import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditMaterialDialog } from './edit-material-dialog'
import type { Material } from '../types/inventory'

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { patch },
  ApiError: class ApiError extends Error {},
}))
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
  const onOpenChange = vi.fn()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <EditMaterialDialog material={material} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return { invalidate, onOpenChange }
}

describe('edit material dialog', () => {
  it('saves all three prices through the material endpoint and refreshes pricing caches', async () => {
    const { invalidate, onOpenChange } = renderForm()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Linen' },
    })
    fireEvent.change(screen.getByLabelText('Normal price'), {
      target: { value: '25.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Material' }))
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/materials/m1', {
        name: 'Linen',
        sku: null,
        family: null,
        unit: 'meters',
        juniorPrice: 10,
        normalPrice: 25.5,
        largePrice: 30,
      }),
    )
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['materials'] }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
  it('keeps edits open after a failed save', async () => {
    const { onOpenChange } = renderForm()
    patch.mockRejectedValue(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Material' }))
    await waitFor(() => expect(patch).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Save Material' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })
  it('blocks negative prices before writing to the catalog', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Junior price'), {
      target: { value: '-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Material' }))
    await screen.findByText(
      'Enter a nonnegative amount with at most two decimal places.',
    )
    expect(patch).not.toHaveBeenCalled()
  })
})
