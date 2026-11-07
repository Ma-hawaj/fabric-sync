import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api'
import { MergeCustomerDialog } from './merge-customer-dialog'
import type { Customer } from '../types/customers'

vi.mock('@/lib/api', () => ({ apiClient: { post: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const source: Customer = {
  id: 'source',
  customerNumber: 1,
  name: 'Ali Ahmad',
  mobileNo: '+97333112233',
  measurements: [],
  invoices: [],
}
const target: Customer = {
  ...source,
  id: 'target',
  customerNumber: 2,
  name: 'Ali Ahmed',
}
const third: Customer = {
  ...source,
  id: 'third',
  customerNumber: 3,
  name: 'Another customer',
}
const choices = [source, target, third]

// Exercise the real mutation and dialog; keep remote picker requests out of
// these tests so failures and retries belong to the merge request itself.
vi.mock('@/components/form/async-combobox', () => ({
  AsyncCombobox: ({
    id,
    onSelectRow,
  }: {
    id: string
    onSelectRow: (customer: Customer | null) => void
  }) => (
    <select
      id={id}
      defaultValue=""
      onChange={(event) =>
        onSelectRow(choices.find((c) => c.id === event.target.value) ?? null)
      }
    >
      <option value="">Choose a customer</option>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  ),
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const onMerged = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <MergeCustomerDialog
        source={source}
        onMerged={onMerged}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { client, onMerged, onClose }
}
const choose = (id = 'target') =>
  fireEvent.change(screen.getByLabelText('Customer to keep'), {
    target: { value: id },
  })
const confirm = () => fireEvent.click(screen.getByRole('checkbox'))

beforeEach(() => vi.clearAllMocks())

describe('customer merge', () => {
  it('requires a destination and explicit same-person confirmation', () => {
    setup()
    const submit = screen.getByRole('button', {
      name: 'Merge customers',
    })
    expect(submit.hasAttribute('disabled')).toBe(true)
    choose()
    expect(submit.hasAttribute('disabled')).toBe(true)
    confirm()
    expect(submit.hasAttribute('disabled')).toBe(false)
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.getByText(/relatives sharing a phone/i)).toBeTruthy()
  })

  it('cannot merge a record into itself', () => {
    setup()
    choose('source')
    expect(screen.getByRole('alert').textContent).toMatch(/different customer/i)
    expect(
      screen
        .getByRole('button', {
          name: 'Merge customers',
        })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('resets confirmation when the customer to keep changes', () => {
    setup()
    choose()
    confirm()
    choose('third')
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(
      screen
        .getByRole('button', {
          name: 'Merge customers',
        })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('moves to the surviving customer and refreshes history and picker caches', async () => {
    const { client, onMerged, onClose } = setup()
    const keys = [
      'customers',
      'orders',
      'invoices',
      'repairs',
      'gift-cards',
      'notifications',
      'invoice-customer',
      'merge-customer',
    ]
    for (const key of keys) client.setQueryData([key, 'cached'], {})
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        ...target,
        measurements: [
          { id: 'measurement', date: '2026-11-07', readableId: 'C-1-001' },
        ],
      },
    })
    choose()
    confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Merge customers' }))
    await waitFor(() => expect(onMerged).toHaveBeenCalledOnce())
    expect(apiClient.post).toHaveBeenCalledWith('/customers/source/merge', {
      targetCustomerId: 'target',
    })
    expect(onMerged.mock.calls[0][0].id).toBe('target')
    expect(onMerged.mock.calls[0][0].measurements[0].date).toBeInstanceOf(Date)
    expect(onMerged.mock.calls[0][0].measurements[0].readableId).toBe('C-1-001')
    expect(onClose).toHaveBeenCalledOnce()
    for (const key of keys)
      expect(client.getQueryState([key, 'cached'])?.isInvalidated).toBe(true)
  })

  it('keeps the dialog and existing records on server failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new Error('Customer has already been merged'),
    )
    const { onMerged, onClose } = setup()
    choose()
    confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Merge customers' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /already been merged/,
    )
    expect(onMerged).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole('button', {
          name: 'Merge customers',
        })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('blocks double submission and closing while a merge is running', async () => {
    let finish!: (value: { data: Customer }) => void
    vi.mocked(apiClient.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { onClose } = setup()
    choose()
    confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Merge customers' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Merging...' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Merging...' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apiClient.post).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish({ data: target }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})
