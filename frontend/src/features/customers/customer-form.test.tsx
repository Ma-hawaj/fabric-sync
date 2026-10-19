import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { CustomerFormPage } from './customer-form'
import type { Customer } from './types/customers'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}))

const preferenceLabel = 'Receive invoice and pickup updates via WhatsApp'
const customer: Customer = {
  id: 'customer-1',
  name: 'Ahmed',
  mobileNo: '+97333112233',
  whatsappNotificationsEnabled: true,
  measurements: [],
  invoices: [],
}

function mount(existing?: Customer) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (existing) client.setQueryData(['customers', existing.id], existing)
  render(
    <QueryClientProvider client={client}>
      <CustomerFormPage customerId={existing?.id} />
    </QueryClientProvider>,
  )
}

describe('saving the customer WhatsApp preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ data: customer })
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { ...customer, whatsappNotificationsEnabled: false },
    })
    vi.mocked(apiClient.post).mockResolvedValue({ data: customer })
  })

  it('keeps changes local until Save submits customer details and the preference together', async () => {
    mount(customer)
    const checkbox = screen.getByRole('checkbox', { name: preferenceLabel })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByRole('textbox', { name: 'Full Name' }), {
      target: { value: 'Ahmed Hassan' },
    })
    expect(apiClient.patch).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/customers/customer-1', {
        name: 'Ahmed Hassan',
        mobileNo: '+97333112233',
        whatsappNotificationsEnabled: false,
        address: '',
      }),
    )
    expect(apiClient.patch).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/customers' }),
    )
  })

  it('loads a saved opt-out and cancels a changed preference without persisting it', () => {
    mount({ ...customer, whatsappNotificationsEnabled: false })
    const checkbox = screen.getByRole('checkbox', { name: preferenceLabel })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(apiClient.patch).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({ to: '/customers' })
  })

  it('retains an unsaved preference after a failed save so it can be retried', async () => {
    vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('Save failed'))
    mount(customer)
    fireEvent.click(screen.getByRole('checkbox', { name: preferenceLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Save' })
          .disabled,
      ).toBe(false),
    )
    expect(navigate).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole('checkbox', { name: preferenceLabel })
        .getAttribute('aria-checked'),
    ).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(2))
    expect(apiClient.patch).toHaveBeenLastCalledWith('/customers/customer-1', {
      name: 'Ahmed',
      mobileNo: '+97333112233',
      whatsappNotificationsEnabled: false,
      address: '',
    })
    await waitFor(() => expect(navigate).toHaveBeenCalled())
  })

  it('defaults new customers to enabled and includes an explicit opt-out in the create request', async () => {
    mount()
    const checkbox = screen.getByRole('checkbox', { name: preferenceLabel })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Full Name' }), {
      target: { value: 'Ahmed' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone' }), {
      target: { value: '+97333112233' },
    })
    fireEvent.click(checkbox)
    expect(apiClient.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/customers', {
        name: 'Ahmed',
        mobileNo: '+97333112233',
        whatsappNotificationsEnabled: false,
        address: '',
        measurement: null,
      }),
    )
    expect(apiClient.post).toHaveBeenCalledTimes(1)
    expect(apiClient.patch).not.toHaveBeenCalled()
  })
})
