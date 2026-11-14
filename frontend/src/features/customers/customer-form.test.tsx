import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { ConsentResponse } from '@/features/campaigns/types'
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
const marketingLabel = 'Receive promotional offers via WhatsApp'
const consent: ConsentResponse = {
  mobile: '+97333112233',
  consent: {
    granted: true,
    version: 'consent-version',
    observedAt: '2026-11-14T09:00:00Z',
    source: 'Customer preference',
    recordedBy: 'sales',
  },
}
const customer: Customer = {
  id: 'customer-1',
  customerNumber: 23,
  name: 'Ahmed',
  mobileNo: '+97333112233',
  whatsappNotificationsEnabled: true,
  measurements: [],
  invoices: [],
}

function mount(
  existing?: Customer,
  preference = consent,
  cachePreference = true,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (existing) client.setQueryData(['customers', existing.id], existing)
  if (existing && cachePreference)
    client.setQueryData(['marketing-consent', existing.id], preference)
  render(
    <QueryClientProvider client={client}>
      <CustomerFormPage customerId={existing?.id} />
    </QueryClientProvider>,
  )
  return client
}

describe('saving the customer WhatsApp preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      ...useAuth(),
      user: {
        id: 'admin',
        name: 'Admin',
        email: 'admin@example.test',
        roles: ['admin'],
      },
    })
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
    const address = screen.getByRole('textbox', { name: 'Address (optional)' })
    expect(address.tagName).toBe('TEXTAREA')
    fireEvent.change(address, {
      target: { value: 'Building 1\nRoad 2, Manama' },
    })
    expect(apiClient.patch).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/customers/customer-1', {
        name: 'Ahmed Hassan',
        mobileNo: '+97333112233',
        whatsappNotificationsEnabled: false,
        address: 'Building 1\nRoad 2, Manama',
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
        marketingPreference: {
          granted: true,
          expectedMobile: null,
          expectedVersion: null,
        },
      }),
    )
    expect(apiClient.post).toHaveBeenCalledTimes(1)
    expect(apiClient.patch).not.toHaveBeenCalled()
  })

  it('places both preferences in the same form and saves them in one request', async () => {
    mount(customer)
    const updates = screen.getByRole('checkbox', { name: preferenceLabel })
    const promotions = screen.getByRole('checkbox', { name: marketingLabel })
    expect(updates.closest('form')).toBe(promotions.closest('form'))
    expect(screen.queryByRole('button', { name: 'Save preference' })).toBeNull()
    fireEvent.click(updates)
    fireEvent.click(promotions)
    expect(apiClient.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/customers/customer-1',
        expect.objectContaining({
          whatsappNotificationsEnabled: false,
          marketingPreference: {
            granted: false,
            expectedMobile: consent.mobile,
            expectedVersion: 'consent-version',
          },
        }),
      ),
    )
    expect(apiClient.patch).toHaveBeenCalledTimes(1)
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('preserves a saved marketing opt-out when saving unrelated customer details', async () => {
    mount(customer, {
      ...consent,
      consent: { ...consent.consent!, granted: false },
    })
    expect(
      screen
        .getByRole('checkbox', { name: marketingLabel })
        .getAttribute('aria-checked'),
    ).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
    expect(vi.mocked(apiClient.patch).mock.calls[0][1]).not.toHaveProperty(
      'marketingPreference',
    )
  })

  it('defaults an unsaved preference on and records it only with the main Save', async () => {
    mount(customer, { mobile: consent.mobile, consent: null })
    expect(
      screen
        .getByRole('checkbox', { name: marketingLabel })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(apiClient.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/customers/customer-1',
        expect.objectContaining({
          marketingPreference: {
            granted: true,
            expectedMobile: consent.mobile,
            expectedVersion: null,
          },
        }),
      ),
    )
  })

  it('keeps a changed marketing choice after a failed save for retry', async () => {
    vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('Save failed'))
    mount(customer)
    fireEvent.click(screen.getByRole('checkbox', { name: marketingLabel }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Save',
        }).disabled,
      ).toBe(false),
    )
    expect(navigate).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole('checkbox', { name: marketingLabel })
        .getAttribute('aria-checked'),
    ).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(2))
    expect(apiClient.patch).toHaveBeenLastCalledWith(
      '/customers/customer-1',
      expect.objectContaining({
        marketingPreference: {
          granted: false,
          expectedMobile: consent.mobile,
          expectedVersion: 'consent-version',
        },
      }),
    )
  })

  it('does not expose or submit marketing preferences for production-only staff', async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...useAuth(),
      user: {
        id: 'production',
        name: 'Production',
        email: 'production@example.test',
        roles: ['production'],
      },
    })
    mount(customer)
    expect(screen.queryByRole('checkbox', { name: marketingLabel })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
    expect(vi.mocked(apiClient.patch).mock.calls[0][1]).not.toHaveProperty(
      'marketingPreference',
    )
  })

  it('waits for saved preferences instead of allowing the checked default to overwrite a failed lookup', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Lookup failed'))
    mount(customer, consent, false)
    await screen.findByText('Could not load WhatsApp preferences.')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(apiClient.patch).not.toHaveBeenCalled()
  })

  it('does not re-enable invoice updates when another shared profile changes the preference', async () => {
    const client = mount(customer)
    await act(async () => {
      client.setQueryData(['customers', customer.id], {
        ...customer,
        whatsappNotificationsEnabled: false,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
    expect(vi.mocked(apiClient.patch).mock.calls[0][1]).not.toHaveProperty(
      'whatsappNotificationsEnabled',
    )
  })

  it('does not re-enable promotions when the cache refreshes to an opt-out during a routine edit', async () => {
    const client = mount(customer)
    await act(async () => {
      client.setQueryData(['marketing-consent', customer.id], {
        ...consent,
        consent: {
          ...consent.consent!,
          granted: false,
          version: 'withdrawn-version',
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled())
    expect(vi.mocked(apiClient.patch).mock.calls[0][1]).not.toHaveProperty(
      'marketingPreference',
    )
  })
})
