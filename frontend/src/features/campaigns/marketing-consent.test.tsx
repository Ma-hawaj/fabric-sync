import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { MarketingConsentPanel } from './marketing-consent'

vi.mock('sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
  ApiError: class extends Error {},
}))
beforeEach(() => vi.clearAllMocks())
it('requires an explicit consent record and keeps it independent of customer details', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['campaign-capabilities'], {
    timezone: 'Asia/Bahrain',
    canSend: false,
    canManageTemplates: false,
  })
  const current = { mobile: '+97333112233', consent: null }
  client.setQueryData(['marketing-consent', 'customer-1'], current)
  vi.mocked(apiClient.get).mockResolvedValue({ data: current })
  vi.mocked(apiClient.put).mockResolvedValue({ data: current })
  render(
    <QueryClientProvider client={client}>
      <MarketingConsentPanel customerId="customer-1" />
    </QueryClientProvider>,
  )
  expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'Record marketing consent' }),
  )
  await screen.findByText('Record how consent was obtained.')
  expect(apiClient.put).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(
    screen.getByLabelText('How consent or withdrawal was obtained'),
    { target: { value: 'Signed in-store request' } },
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Record marketing consent' }),
  )
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith(
      '/customers/customer-1/marketing-consent',
      expect.objectContaining({
        expectedMobile: '+97333112233',
        granted: true,
        source: 'Signed in-store request',
        observedAt: expect.any(String),
      }),
    ),
  )
})
