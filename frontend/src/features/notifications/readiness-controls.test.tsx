import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { ReadinessControls } from './readiness-controls'
import type { NotificationDraft } from './types'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(() => Promise.resolve({})),
  },
}))

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
      messages: [
        {
          body: 'Your order is ready for pickup.',
          language: 'en_US',
          attachInvoice: false,
        },
      ],
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
        messages: [{ messageIndex: 0, status: 'draft', errorMessage: null }],
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

  it.each([true, false])(
    'only opens the pickup preview when the order makes its invoice ready (becameReady=%s)',
    async (becameReady) => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { becameReady },
      })
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
      const controls = (status: string) => (
        <QueryClientProvider client={client}>
          <ReadinessControls
            id="order-1"
            invoiceId="invoice-1"
            scope="orders"
            status={status}
          />
        </QueryClientProvider>
      )
      const { rerender } = render(controls('in_progress'))
      fireEvent.click(
        screen.getByRole('button', { name: 'Mark ready for pickup' }),
      )
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: 'I confirm the garments are available at the pickup branch.',
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Confirm ready' }))
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: 'Confirm ready for pickup' }),
        ).toBeNull(),
      )
      expect(apiClient.post).toHaveBeenCalledWith('/orders/order-1/ready', {
        confirmedAtPickupBranch: true,
      })
      rerender(controls('ready'))
      if (becameReady) {
        await screen.findByRole('heading', {
          name: 'Ready for pickup — notify customers',
        })
        await screen.findByText(/1 unique mobile selected/)
        expect(apiClient.post).toHaveBeenCalledWith(
          '/invoices/invoice-1/notifications',
          expect.objectContaining({ kind: 'invoice_ready' }),
        )
      } else {
        expect(
          screen.queryByRole('heading', {
            name: 'Ready for pickup — notify customers',
          }),
        ).toBeNull()
        expect(
          vi
            .mocked(apiClient.post)
            .mock.calls.some(
              ([path]) => path === '/invoices/invoice-1/notifications',
            ),
        ).toBe(false)
      }
      expect(
        vi
          .mocked(apiClient.post)
          .mock.calls.some(([path]) => String(path).endsWith('/send')),
      ).toBe(false)
    },
  )
})
