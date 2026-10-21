import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { NotificationHistory } from './notification-history'
import type { NotificationHistoryRow } from './types'

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

function row(
  id: string,
  values: Partial<NotificationHistoryRow> = {},
): NotificationHistoryRow {
  return {
    id,
    kind: 'manual_resend',
    state: 'approved',
    createdAt: '2026-10-21T10:00:00Z',
    recipientCount: 1,
    queuedCount: 0,
    acceptedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    uncertainCount: 0,
    cancelledCount: 0,
    ...values,
  }
}

function mount(rows: NotificationHistoryRow[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['notifications', 'invoice-1'], rows)
  return render(
    <QueryClientProvider client={client}>
      <NotificationHistory invoiceId="invoice-1" />
    </QueryClientProvider>,
  )
}

describe('compact notification history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.delete).mockResolvedValue({})
  })

  it('shows the latest invoice and pickup results and loads delivery details only on demand', async () => {
    mount([
      row('latest-invoice', { deliveredCount: 1 }),
      row('latest-ready', { kind: 'invoice_ready', queuedCount: 1 }),
      row('old-invoice', { kind: 'invoice_updated', failedCount: 1 }),
    ])
    expect(screen.getByText('1 delivered')).toBeTruthy()
    expect(screen.getByText('1 queued')).toBeTruthy()
    expect(screen.queryByText('Updated invoice')).toBeNull()
    expect(screen.queryByText('1 failed')).toBeNull()
    expect(screen.queryByText('Delivery details')).toBeNull()
    expect(apiClient.get).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('View history (3)'))
    await screen.findByText('Updated invoice')
    expect(apiClient.get).not.toHaveBeenCalled()
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        recipients: [
          {
            id: 'selected',
            selected: true,
            customers: [{ name: 'Ahmed' }],
            normalizedMobile: '+97333112233',
            status: 'failed',
            errorMessage: 'Provider rejected the message.',
          },
          {
            id: 'excluded',
            selected: false,
            customers: [{ name: 'Excluded customer' }],
            normalizedMobile: '+97333991122',
            status: 'draft',
          },
        ],
      },
    })
    const olderEntry = screen.getByText('Updated invoice').parentElement!
    fireEvent.click(within(olderEntry).getByText('Delivery details'))
    await screen.findByText('Provider rejected the message.')
    expect(apiClient.get).toHaveBeenCalledExactlyOnceWith(
      '/notifications/old-invoice',
    )
    expect(screen.queryByText(/Excluded customer/)).toBeNull()
  })

  it('shows an empty summary without a history list when no send has been approved', () => {
    mount([])
    expect(screen.getAllByText('Not sent')).toHaveLength(2)
    expect(screen.queryByText(/View history/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview resend' })).toBeNull()
  })

  it('opens a new preview for the latest send and keeps failed and uncertain outcomes visible', async () => {
    mount([
      row('latest-invoice', {
        recipientCount: 2,
        failedCount: 1,
        uncertainCount: 1,
      }),
      row('latest-ready', { kind: 'invoice_ready', acceptedCount: 1 }),
    ])
    expect(screen.getByText('1 failed · 1 uncertain')).toBeTruthy()
    expect(screen.getByText('1 accepted')).toBeTruthy()
    expect(screen.queryByText(/delivered/)).toBeNull()
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'new-preview',
        invoiceId: 'invoice-1',
        kind: 'invoice_ready',
        state: 'draft',
        previewVersion: 'v1',
        canSend: true,
        artifactId: null,
        snapshot: {
          invoiceNumber: 42,
          body: 'Ready for pickup.',
          exclusions: [],
        },
        recipients: [],
      },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Preview resend' })[1],
    )
    await screen.findByText('Ready for pickup.')
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/invoices/invoice-1/notifications',
        {
          kind: 'invoice_ready',
          resendOf: 'latest-ready',
          requestId: expect.any(String),
        },
      ),
    )
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })
})
