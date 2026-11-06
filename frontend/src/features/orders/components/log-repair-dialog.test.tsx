import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogRepairDialog } from './log-repair-dialog'
import type { OrderDetail } from '../types/orders'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('../hooks/use-create-repair', () => ({
  useCreateRepair: () => ({ mutateAsync, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))

const order = {
  id: 'order-1',
  customerName: 'Test customer',
  material: 'Cotton',
  measurement: {
    id: 'measurement-1',
    readableId: 'C-23-001',
    date: new Date('2026-10-01'),
    type: 'body',
    fit: 'fit',
    chest: 42,
  },
} as OrderDetail

afterEach(cleanup)
beforeEach(() => {
  mutateAsync.mockReset()
  mutateAsync.mockResolvedValue({})
})

function enterReason() {
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Adjust chest' },
  })
}

describe('LogRepairDialog', () => {
  it('prompts for measurements and allows a repair without measurement changes', async () => {
    const onOpenChange = vi.fn()
    render(<LogRepairDialog order={order} onOpenChange={onOpenChange} />)
    expect(
      screen.getByRole('radiogroup', {
        name: 'Update measurements for this repair?',
      }),
    ).toBeTruthy()
    enterReason()
    fireEvent.click(screen.getByRole('button', { name: 'Log Repair' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Adjust chest',
        measurement: undefined,
      }),
    )
  })

  it('offers the existing fits and saves a typed custom fit with edited measurements', async () => {
    render(<LogRepairDialog order={order} onOpenChange={vi.fn()} />)
    enterReason()
    fireEvent.click(screen.getByRole('radio', { name: 'Update measurements' }))
    const chest = screen.getByLabelText('Chest')
    expect((chest as HTMLInputElement).value).toBe('42')
    fireEvent.change(chest, { target: { value: '44' } })
    const fit = screen.getByRole<HTMLInputElement>('textbox', { name: 'Fit' })
    expect(fit.value).toBe('fit')
    for (const option of ['Loose', 'Medium', 'Fit']) {
      const preset = screen.getByRole('radio', { name: option, exact: true })
      fireEvent.click(preset)
      expect(fit.value).toBe(option.toLowerCase())
      expect(preset.getAttribute('aria-checked')).toBe('true')
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Fit' }), {
      target: { value: 'Slim with extra chest room' },
    })
    expect(
      screen
        .getByRole('radio', { name: 'Fit', exact: true })
        .getAttribute('aria-checked'),
    ).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Log Repair' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        measurement: expect.objectContaining({
          chest: 44,
          type: 'body',
          fit: 'Slim with extra chest room',
        }),
      }),
    )
  })

  it('keeps the dialog open when saving fails', async () => {
    mutateAsync.mockRejectedValue(new Error('Save failed'))
    const onOpenChange = vi.fn()
    render(<LogRepairDialog order={order} onOpenChange={onOpenChange} />)
    enterReason()
    fireEvent.click(screen.getByRole('button', { name: 'Log Repair' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
