import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SendGiftCardDialog } from './send-gift-card-dialog'
import { apiClient } from '@/lib/api'
import type { GiftCard } from '../types/gift-card'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const card: GiftCard = {
  id: 'card-1',
  code: 'GC-AUTO',
  initialAmount: 50,
  balance: 50,
  customerId: null,
  customerName: null,
  boughtFor: 'Recipient',
  recipientPhone: '+97333112233',
  deliveryStatus: null,
  deliveryError: null,
  expiresOn: null,
  isActive: true,
}
const preview = {
  sourceHash: 'preview-version',
  mobile: '+97333112233',
  boughtFor: 'Recipient',
  body: 'Hello Recipient. Code: GC-AUTO. Available balance: 50.000 BHD.',
  canSend: true,
  unavailableReason: null,
}

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SendGiftCardDialog card={card} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('gift card WhatsApp approval', () => {
  it('previews the recipient and code without sending, then sends only after approval', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: preview })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { state: 'queued' } })
    const onClose = open()
    expect(await screen.findByText(preview.body)).toBeTruthy()
    expect(screen.getByText(/Recipient · \+97333112233/)).toBeTruthy()
    expect(apiClient.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(apiClient.post).toHaveBeenCalledWith('/gift-cards/card-1/send', {
      sourceHash: preview.sourceHash,
      requestId: expect.any(String),
    })
  })

  it('keeps unavailable delivery disabled and closing never sends', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...preview,
        canSend: false,
        unavailableReason: 'WhatsApp delivery is not configured.',
      },
    })
    const onClose = open()
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'WhatsApp delivery is not configured.',
    )
    expect(
      screen
        .getByRole('button', { name: 'Send via WhatsApp' })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('shows a stale preview error and preserves the approval identity when retried', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: preview })
    vi.mocked(apiClient.post).mockRejectedValue(
      new Error('The gift card or recipient changed.'),
    )
    const onClose = open()
    await screen.findByText(preview.body)
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The gift card or recipient changed.',
    )
    expect(onClose).not.toHaveBeenCalled()
    const first = vi.mocked(apiClient.post).mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2))
    expect(vi.mocked(apiClient.post).mock.calls[1][1]).toEqual(first)
  })
})
