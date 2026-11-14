import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { MarketingConsentPanel } from './marketing-consent'
import type { ConsentResponse } from './types'

vi.mock('sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
  ApiError: class extends Error {},
}))
const preferenceLabel = 'Receive promotional offers via WhatsApp'
const unsaved: ConsentResponse = { mobile: '+97333112233', consent: null }
function saved(granted: boolean): ConsentResponse {
  return {
    mobile: unsaved.mobile,
    consent: {
      granted,
      version: 'saved-version',
      observedAt: '2026-11-14T09:00:00Z',
      source: 'Customer preference',
      recordedBy: 'sales',
    },
  }
}
function mount(current = unsaved) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['marketing-consent', 'customer-1'], current)
  let response = current
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: response }))
  vi.mocked(apiClient.put).mockImplementation(async (_, body) => {
    response = saved((body as { granted: boolean }).granted)
    return { data: response }
  })
  render(
    <QueryClientProvider client={client}>
      <MarketingConsentPanel customerId="customer-1" />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.put).mockReset()
})

it('defaults the checkbox on without enrolling anyone until the preference is saved', async () => {
  mount()
  expect(
    screen
      .getByRole('checkbox', { name: preferenceLabel })
      .getAttribute('aria-checked'),
  ).toBe('true')
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByLabelText(/when|obtained/i)).toBeNull()
  expect(apiClient.get).not.toHaveBeenCalled()
  expect(apiClient.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      '/customers/customer-1/marketing-consent',
      { expectedMobile: '+97333112233', granted: true },
    ),
  )
})

it('preserves a saved opt-out instead of replacing it with the new default', async () => {
  mount(saved(false))
  expect(
    screen
      .getByRole('checkbox', { name: preferenceLabel })
      .getAttribute('aria-checked'),
  ).toBe('false')
  expect(apiClient.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      '/customers/customer-1/marketing-consent',
      { expectedMobile: '+97333112233', granted: false },
    ),
  )
})

it('saves an unchecked preference without requiring a reason or date', async () => {
  mount(saved(true))
  fireEvent.click(screen.getByRole('checkbox', { name: preferenceLabel }))
  expect(apiClient.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      '/customers/customer-1/marketing-consent',
      { expectedMobile: '+97333112233', granted: false },
    ),
  )
})

it('retains the chosen preference after a failed save and allows retry', async () => {
  mount(saved(false))
  vi.mocked(apiClient.put).mockRejectedValueOnce(
    new Error('Could not save preference'),
  )
  fireEvent.click(screen.getByRole('checkbox', { name: preferenceLabel }))
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Could not save preference')).toBeTruthy()
  expect(
    screen
      .getByRole('checkbox', { name: preferenceLabel })
      .getAttribute('aria-checked'),
  ).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Save preference' }))
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(2))
  expect(apiClient.put).toHaveBeenLastCalledWith(
    '/customers/customer-1/marketing-consent',
    { expectedMobile: '+97333112233', granted: true },
  )
})

it('requires a saved valid phone before showing the checkbox', () => {
  mount({ mobile: null, consent: null })
  expect(
    screen.getByText(
      'Save a valid mobile number to set the promotions preference.',
    ),
  ).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(apiClient.put).not.toHaveBeenCalled()
})
