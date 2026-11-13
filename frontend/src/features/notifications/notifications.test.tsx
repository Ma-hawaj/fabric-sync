import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import type { ComponentProps } from 'react'
import { apiClient } from '@/lib/api'
import { NotificationsPage } from './notifications'
import type { NotificationAttentionRow, NotificationKind } from './types'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    ...props
  }: ComponentProps<'a'> & { to: string; params?: Record<string, string> }) => (
    <a
      href={to.replace(/\$\w+/, Object.values(params ?? {})[0] ?? '')}
      {...props}
    />
  ),
}))
vi.mock('@/features/gift-cards/components/send-gift-card-dialog', () => ({
  SendGiftCardDialog: ({ card }: { card: { id: string; code: string } }) => (
    <div role="dialog" aria-label="Gift card preview">
      {card.id} · {card.code}
    </div>
  ),
}))
vi.mock('./notification-dialog', () => ({
  NotificationDialog: ({
    invoiceId,
    kind,
    resendOf,
    repairId,
    onClose,
  }: {
    invoiceId: string | null
    kind: NotificationKind
    resendOf?: string
    repairId?: string
    onClose: () => void
  }) =>
    invoiceId ? (
      <div role="dialog" aria-label="Notification preview">
        {invoiceId} · {kind} · {resendOf} · {repairId}
        <button onClick={onClose}>Close preview</button>
      </div>
    ) : null,
}))

function row(
  invoiceId: string,
  values: Partial<NotificationAttentionRow> = {},
): NotificationAttentionRow {
  return {
    entityId: invoiceId,
    reference: 'INV-42',
    invoiceId,
    invoiceNumber: 42,
    giftCardId: null,
    giftCardCode: null,
    repairId: null,
    orderId: null,
    repairReason: null,
    branchName: 'Manama',
    customers: [{ id: 'ahmed', name: 'Ahmed', mobileNo: '33112233' }],
    kind: 'invoice',
    status: 'not_sent',
    eligible: true,
    needsAttention: true,
    waitingSince: '2026-10-20T10:00:00Z',
    lastAttemptAt: null,
    notificationId: null,
    recipientCount: 0,
    queuedCount: 0,
    acceptedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    uncertainCount: 0,
    cancelledCount: 0,
    recipients: [],
    errorMessage: null,
    previousVersion: null,
    ...values,
  }
}

function mount(
  rows: NotificationAttentionRow[],
  {
    view = 'attention',
    kind = '',
    total = rows.length,
    summaryTotal = total,
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const search = new URLSearchParams({ page: '1', perPage: '25' })
  const filters: object[] = kind
    ? [
        {
          id: 'kind',
          value: [kind],
          variant: 'multiSelect',
          operator: 'inArray',
        },
      ]
    : []
  filters.push({
    id: 'needsAttention',
    value: view !== 'history',
    operator: 'eq',
    variant: 'boolean',
  })
  if (view !== 'attention' && view !== 'history')
    filters.push({
      id: 'status',
      value: view,
      operator: 'eq',
      variant: 'select',
    })
  search.set('filters', JSON.stringify(filters))
  search.set('joinOperator', 'and')
  client.setQueryData(['notification-attention', search.toString()], {
    data: rows,
    total,
    page: 1,
    perPage: 25,
    pageCount: Math.ceil(total / 25),
  })
  client.setQueryData(['notification-attention-summary'], {
    total: summaryTotal,
    notSent: 2,
    failed: 1,
    uncertain: 1,
    delayed: 1,
  })
  render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter
        hasMemory
        searchParams={
          new URLSearchParams({
            ...(view === 'attention' ? {} : { view }),
            ...(kind ? { kind } : {}),
          })
        }
      >
        <NotificationsPage />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  return client
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (originalScrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView,
    )
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('notification attention queue', () => {
  it('shows global counts and opens the existing preview for a forgotten invoice without sending', () => {
    mount([row('invoice-42')], { total: 31 })
    expect(
      screen
        .getByRole('button', { name: 'Needs attention 31' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText('Ahmed')).toBeTruthy()
    expect(screen.getByText('Invoice message outstanding')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview & send' }))
    expect(
      screen.getByRole('dialog', { name: 'Notification preview' }).textContent,
    ).toContain('invoice-42 · invoice_created')
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('previews a forgotten pickup notice with the ready message kind', () => {
    mount([row('invoice-42', { kind: 'invoice_ready' })])
    expect(screen.getByText('Ready but not notified')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview & send' }))
    expect(screen.getByRole('dialog').textContent).toContain('invoice_ready')
  })

  it('flags changed content while preserving the previous delivery result', () => {
    mount([
      row('invoice-42', {
        notificationId: 'previous-send',
        previousVersion: {
          status: 'delivered',
          recipients: [],
          errorMessage: null,
        },
      }),
    ])
    expect(screen.getByText('Updated version not sent')).toBeTruthy()
    expect(screen.getByText('Previous version: Delivered')).toBeTruthy()
    expect(screen.queryByText('Invoice message outstanding')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Preview update' }))
    expect(screen.getByRole('dialog').textContent).toContain(
      'invoice-42 · invoice_updated · previous-send',
    )
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('opens the earlier delivery details without sending the updated version', () => {
    mount([
      row('invoice-42', {
        notificationId: 'previous-send',
        previousVersion: {
          status: 'delivered',
          errorMessage: null,
          recipients: [
            {
              id: 'previous-recipient',
              normalizedMobile: '+97333112233',
              customers: [
                { id: 'a', name: 'Ahmed', mobileNo: '33112233', enabled: true },
              ],
              selected: true,
              status: 'delivered',
              errorMessage: null,
            },
          ],
        },
      }),
    ])
    fireEvent.click(
      screen.getByRole('button', { name: 'Previous version: Delivered' }),
    )
    const detail = screen.getByRole('dialog')
    expect(within(detail).getByText('Updated version not sent')).toBeTruthy()
    expect(within(detail).getByText('+97333112233')).toBeTruthy()
    expect(within(detail).getByText('Delivered')).toBeTruthy()
    expect(
      within(detail).getByRole('button', { name: 'Preview updated message' }),
    ).toBeTruthy()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('keeps the repair context when previewing an updated repair notice', () => {
    mount([
      row('repair-1', {
        kind: 'repair_ready',
        invoiceId: 'invoice-42',
        repairId: 'repair-1',
        notificationId: 'previous-repair-send',
        previousVersion: {
          status: 'accepted',
          recipients: [],
          errorMessage: null,
        },
      }),
    ])
    expect(
      screen.getByText('Previous version: Accepted by WhatsApp'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview update' }))
    expect(screen.getByRole('dialog').textContent).toContain(
      'invoice-42 · invoice_ready · previous-repair-send · repair-1',
    )
  })

  it('requires checking an uncertain previous version before previewing the update', () => {
    mount([
      row('invoice-42', {
        notificationId: 'previous-send',
        previousVersion: {
          status: 'uncertain',
          errorMessage: 'Submission interrupted',
          recipients: [
            {
              id: 'previous-recipient',
              normalizedMobile: '+97333112233',
              customers: [
                { id: 'a', name: 'Ahmed', mobileNo: '33112233', enabled: true },
              ],
              selected: true,
              status: 'uncertain',
              errorMessage: 'Submission interrupted',
            },
          ],
        },
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const detail = screen.getByRole('dialog')
    expect(
      within(detail).getByText(/needs a fresh preview and approval/),
    ).toBeTruthy()
    expect(
      within(detail).getByText('Previous version: latest result per recipient'),
    ).toBeTruthy()
    expect(within(detail).getByText('+97333112233')).toBeTruthy()
    const preview = within(detail).getByRole('button', {
      name: 'Preview updated message',
    })
    expect(preview.hasAttribute('disabled')).toBe(true)
    fireEvent.click(
      within(detail).getByRole('checkbox', { name: /I checked delivery/ }),
    )
    expect(preview.hasAttribute('disabled')).toBe(false)
    fireEvent.click(preview)
    expect(screen.getByRole('dialog').textContent).toContain(
      'invoice_updated · previous-send',
    )
  })

  it('labels invoice sends and ready notices separately', () => {
    mount([
      row('invoice-42'),
      row('invoice-43', { kind: 'invoice_ready', reference: 'INV-43' }),
    ])
    expect(
      screen.getByRole('columnheader', { name: /^Notification type/ }),
    ).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Invoice send' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Ready' })).toBeTruthy()
  })

  it('offers all four notification types in the filter', async () => {
    mount([])
    fireEvent.click(
      screen.getByRole('button', { name: 'Notification type', exact: true }),
    )
    for (const type of ['Invoice send', 'Ready', 'Repair ready', 'Gift card']) {
      expect(
        await screen.findByRole('option', { name: type, exact: true }),
      ).toBeTruthy()
    }
  })

  it('opens the gift card preview for an unsent card without an invoice', () => {
    mount([
      row('card-1', {
        reference: 'GC-1234',
        kind: 'gift_card',
        giftCardId: 'card-1',
        giftCardCode: 'GC-1234',
        invoiceId: null,
        invoiceNumber: null,
      }),
    ])
    expect(
      screen.getByRole('link', { name: 'GC-1234' }).getAttribute('href'),
    ).toBe('/gift-cards/GC-1234')
    expect(screen.getByRole('cell', { name: 'Gift card' })).toBeTruthy()
    expect(screen.getByText('Gift card not sent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview & send' }))
    expect(
      screen.getByRole('dialog', { name: 'Gift card preview' }).textContent,
    ).toContain('card-1 · GC-1234')
    expect(
      screen.queryByRole('dialog', { name: 'Notification preview' }),
    ).toBeNull()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('keeps two gift cards sold on the same invoice separate', () => {
    mount([
      row('card-1', {
        reference: 'GC-1234',
        kind: 'gift_card',
        giftCardId: 'card-1',
        giftCardCode: 'GC-1234',
        invoiceId: 'invoice-42',
      }),
      row('card-2', {
        reference: 'GC-5678',
        kind: 'gift_card',
        giftCardId: 'card-2',
        giftCardCode: 'GC-5678',
        invoiceId: 'invoice-42',
      }),
    ])
    expect(screen.getByRole('link', { name: 'GC-1234' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'GC-5678' })).toBeTruthy()
  })

  it('preserves notification type filters in the URL and API request', () => {
    mount(
      [
        row('card-1', {
          reference: 'GC-1234',
          kind: 'gift_card',
          giftCardId: 'card-1',
          giftCardCode: 'GC-1234',
        }),
      ],
      { kind: 'gift_card' },
    )
    expect(screen.getByRole('link', { name: 'GC-1234' })).toBeTruthy()
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('explains that repair-ready notifications have their own context', () => {
    mount([], { kind: 'repair_ready' })
    expect(
      screen.getByText(
        'Repair-ready notices are tracked separately for each repair, including repairs of collected orders.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Preview & send' })).toBeNull()
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('passes a specific repair into the pickup preview and links to its order', () => {
    mount([
      row('repair-1', {
        kind: 'repair_ready',
        reference: 'ORD-101 repair',
        invoiceId: 'invoice-42',
        repairId: 'repair-1',
        orderId: 'order-101',
        repairReason: 'Shorten sleeve',
      }),
    ])
    expect(
      screen.getByRole('link', { name: 'ORD-101 repair' }).getAttribute('href'),
    ).toBe('/orders/order-101')
    expect(screen.getByRole('cell', { name: 'Repair ready' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Preview & send' }))
    expect(screen.getByRole('dialog').textContent).toContain(
      'invoice-42 · invoice_ready ·  · repair-1',
    )
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('shows partial recipient failures and opens a linked resend for review', () => {
    mount([
      row('invoice-42', {
        status: 'failed',
        notificationId: 'send-2',
        recipientCount: 2,
        failedCount: 1,
        deliveredCount: 1,
        recipients: [
          {
            id: 'first',
            normalizedMobile: '+97333112233',
            customers: [
              { id: 'a', name: 'Ahmed', mobileNo: '33112233', enabled: true },
            ],
            selected: true,
            status: 'delivered',
            errorMessage: null,
          },
          {
            id: 'second',
            normalizedMobile: '+97333991122',
            customers: [
              { id: 'b', name: 'Fatima', mobileNo: '33991122', enabled: true },
            ],
            selected: true,
            status: 'failed',
            errorMessage: 'Invalid destination',
          },
        ],
      }),
    ])
    expect(screen.getByText('1 of 2 recipients failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const detail = screen.getByRole('dialog')
    expect(within(detail).getByText('Fatima')).toBeTruthy()
    expect(within(detail).getByText('Invalid destination')).toBeTruthy()
    fireEvent.click(
      within(detail).getByRole('button', { name: 'Preview resend' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Notification preview' }).textContent,
    ).toContain('manual_resend · send-2')
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('requires checking an uncertain delivery before opening a resend', () => {
    mount([
      row('invoice-42', {
        status: 'uncertain',
        notificationId: 'send-1',
        uncertainCount: 1,
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const button = screen.getByRole('button', {
      name: 'Preview resend',
    })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /I checked delivery/ }),
    )
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('keeps a queued retry out of the send flow', () => {
    mount(
      [
        row('invoice-42', {
          status: 'delayed',
          notificationId: 'send-1',
          queuedCount: 1,
        }),
      ],
      { view: 'delayed' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText(/waiting for an automatic retry/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Preview resend' })).toBeNull()
  })

  it('does not report everything caught up when filters hide outstanding notifications', () => {
    mount([], { summaryTotal: 5 })
    expect(screen.getByRole('status').textContent).toContain(
      'No notifications match',
    )
    expect(screen.queryByText(/all caught up/)).toBeNull()
  })

  it('resets pagination when switching to the failed view', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: [], total: 0, page: 1, perPage: 25, pageCount: 0 },
    })
    mount([row('invoice-42')])
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }))
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled())
    const url = new URL(
      vi.mocked(apiClient.get).mock.calls[0][0],
      'http://localhost',
    )
    expect(url.searchParams.get('page')).toBe('1')
    expect(JSON.parse(url.searchParams.get('filters') ?? '[]')).toContainEqual({
      id: 'status',
      value: 'failed',
      operator: 'eq',
      variant: 'select',
    })
  })
})
