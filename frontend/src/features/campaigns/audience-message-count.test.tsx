import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { AudienceMessageCount } from './audience-message-count'
import type { AudienceFormValues } from './lib/audience'

vi.mock('@/lib/api', () => ({
  apiClient: { post: vi.fn() },
  ApiError: class extends Error {},
}))

const values: AudienceFormValues = {
  lastPurchaseFrom: '',
  lastPurchaseTo: '',
  neverPurchased: false,
  minPurchases: '',
  maxPurchases: '',
  minSpend: '',
  maxSpend: '',
  branchId: '',
}
function mount(initial = values, excludedCustomerIds: string[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <AudienceMessageCount
        values={initial}
        excludedCustomerIds={excludedCustomerIds}
      />
    </QueryClientProvider>,
  )
  return {
    ...view,
    change: (next: AudienceFormValues) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <AudienceMessageCount
            values={next}
            excludedCustomerIds={excludedCustomerIds}
          />
        </QueryClientProvider>,
      ),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiClient.post).mockResolvedValue({
    data: { messageCount: 1, matchingCustomers: 3, excludedCustomers: 1 },
  })
})
it('shows eligible unique-message count before any draft or template is saved', async () => {
  mount(values, ['excluded-customer'])
  await screen.findByText('1 WhatsApp message')
  expect(screen.getByText('3 matching customers · 1 excluded')).toBeTruthy()
  expect(apiClient.post).toHaveBeenCalledWith(
    '/campaigns/audience-count',
    expect.objectContaining({
      excludedCustomerIds: ['excluded-customer'],
      minPurchases: null,
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
})
it('updates after filter changes, hides the previous total, and shows zero accurately', async () => {
  const view = mount()
  await screen.findByText('1 WhatsApp message')
  vi.mocked(apiClient.post).mockResolvedValue({
    data: { messageCount: 0, matchingCustomers: 0, excludedCustomers: 0 },
  })
  view.change({ ...values, minPurchases: '5' })
  expect(screen.queryByText('1 WhatsApp message')).toBeNull()
  expect(screen.getByText('Updating message count…')).toBeTruthy()
  await screen.findByText('0 WhatsApp messages')
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/campaigns/audience-count',
    expect.objectContaining({ minPurchases: 5 }),
    expect.any(Object),
  )
})
it('debounces rapid filter edits and ignores unrelated form changes', async () => {
  const view = mount()
  await screen.findByText('1 WhatsApp message')
  view.change({ ...values, minSpend: '1' })
  view.change({ ...values, minSpend: '10' })
  view.change({ ...values, minSpend: '100' })
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2))
  expect(apiClient.post).toHaveBeenLastCalledWith(
    '/campaigns/audience-count',
    expect.objectContaining({ minSpend: '100' }),
    expect.any(Object),
  )
  view.change({ ...values, minSpend: '100' })
  expect(apiClient.post).toHaveBeenCalledTimes(2)
})
it('does not turn invalid purchase counts into an unfiltered total', () => {
  mount({ ...values, minPurchases: '-1' })
  expect(
    screen.getByText('Enter whole, non-negative purchase counts.'),
  ).toBeTruthy()
  expect(apiClient.post).not.toHaveBeenCalled()
})
it('shows count failures and allows retry without submitting the campaign form', async () => {
  vi.mocked(apiClient.post).mockRejectedValueOnce(
    new Error('Audience service unavailable'),
  )
  mount()
  await screen.findByText(/Could not calculate message count/)
  const retry = screen.getByRole('button', { name: 'Retry count' })
  expect(retry.getAttribute('type')).toBe('button')
  fireEvent.click(retry)
  await screen.findByText('1 WhatsApp message')
})
