import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { ReadinessControls } from './readiness-controls'
import type { NotificationDraft } from './types'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))

function fixture(): NotificationDraft {
  return {
    id: 'ready-draft',
    invoiceId: 'invoice-1',
    kind: 'invoice_ready',
    state: 'draft',
    previewVersion: 'version-1',
    artifactId: null,
    canSend: true,
    snapshot: {
      invoiceNumber: 42,
      body: 'Your order is ready for pickup.',
      language: 'en_US',
      exclusions: [],
    },
    recipients: [
      {
        id: 'recipient-1',
        normalizedMobile: '+97333112233',
        customers: [
          {
            id: 'customer-1',
            name: 'Ahmed',
            mobileNo: '33112233',
            enabled: true,
          },
        ],
        selected: true,
        status: 'draft',
        errorMessage: null,
      },
    ],
  }
}

describe('readiness notification lifecycle', () => {
  let draft: NotificationDraft
  beforeEach(() => {
    vi.clearAllMocks()
    draft = fixture()
    vi.mocked(apiClient.post).mockImplementation(async (path, body) => {
      if (String(path).endsWith('/ready'))
        return { data: { becameReady: true } }
      if (String(path).endsWith('/selection')) {
        const selection = body as { selectedMobiles: string[] }
        draft = {
          ...draft,
          previewVersion: 'version-2',
          recipients: draft.recipients.map((recipient) => ({
            ...recipient,
            selected: selection.selectedMobiles.includes(
              recipient.normalizedMobile,
            ),
          })),
        }
      }
      return { data: draft }
    })
  })

  it('preserves the reviewed preview and selection when the invoice becomes ready', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const controls = (status: string) => (
      <QueryClientProvider client={client}>
        <ReadinessControls
          id="invoice-1"
          invoiceId="invoice-1"
          scope="invoices"
          status={status}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(controls('partially_ready'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark remaining orders ready' }),
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm ready' })
        .disabled,
    ).toBe(true)
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I confirm the garments are available at the pickup branch.',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirm ready' }))
    await screen.findByRole('heading', {
      name: 'Ready for pickup — notify customers',
    })
    await screen.findByText(/1 unique mobile selected/)
    fireEvent.click(screen.getByRole('checkbox', { name: /Ahmed/ }))
    await screen.findByText(/0 unique mobiles selected/)

    rerender(controls('ready'))
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Send via WhatsApp',
        }).disabled,
      ).toBe(true),
    )
    expect(screen.getByText(/0 unique mobiles selected/)).toBeTruthy()
    expect(
      vi
        .mocked(apiClient.post)
        .mock.calls.filter(
          ([path]) => path === '/invoices/invoice-1/notifications',
        ),
    ).toHaveLength(1)
    expect(
      vi
        .mocked(apiClient.post)
        .mock.calls.some(([path]) => String(path).endsWith('/send')),
    ).toBe(false)
  })
})
