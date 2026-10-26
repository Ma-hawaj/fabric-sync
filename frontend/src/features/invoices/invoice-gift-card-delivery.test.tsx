import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, ApiError } from '@/lib/api'
import { toast } from 'sonner'
import type * as ApiModule from '@/lib/api'
import { InvoiceForm } from './invoice-form'
import { downloadInvoicePdf } from './lib/print-invoice'
import type { CreatedInvoice } from './lib/invoice-payload'
import {
  createEmptyGiftCardLine,
  createEmptyInvoiceForm,
} from './types/invoice-form'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('sonner', () => ({
  toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() },
}))
vi.mock('./lib/print-invoice', () => ({ downloadInvoicePdf: vi.fn() }))
vi.mock('@/features/notifications/notification-dialog', () => ({
  NotificationDialog: ({
    invoiceId,
    kind,
    onClose,
  }: {
    invoiceId: string | null
    kind: string
    onClose: () => void
  }) =>
    invoiceId ? (
      <div>
        {kind} notification
        <button onClick={onClose}>Finish notifications</button>
      </div>
    ) : null,
}))

const cards = [
  { id: 'card-1', code: 'GC-7KMP-4RWT-9DXH' },
  { id: 'card-2', code: 'GC-8BNQ-5SVX-3FYJ' },
]
function preview(index: number) {
  return {
    sourceHash: `source-${cards[index].id}`,
    mobile: index === 0 ? '+97333112233' : '+97333998877',
    boughtFor: `Recipient ${index + 1}`,
    body: `Gift card for recipient ${index + 1}: ${cards[index].code}`,
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    imageFilename: `gift-card-${cards[index].id}.png`,
    canSend: true,
    unavailableReason: null,
  }
}

let firstCardUnavailable = false
beforeEach(() => {
  vi.resetAllMocks()
  firstCardUnavailable = false
  vi.mocked(downloadInvoicePdf).mockResolvedValue(undefined)
  vi.mocked(apiClient.get).mockImplementation((url) => {
    const index = cards.findIndex(
      (card) => url === `/gift-cards/${card.id}/preview`,
    )
    if (url.startsWith('/locations?') || url.startsWith('/customers?')) {
      return Promise.resolve({
        data: { data: [], page: 1, perPage: 20, total: 0, pageCount: 0 },
      })
    }
    if (index < 0) throw new Error(`Unexpected request: ${url}`)
    return Promise.resolve({
      data: {
        ...preview(index),
        ...(index === 0 && firstCardUnavailable
          ? { canSend: false, unavailableReason: 'Card unavailable' }
          : {}),
      },
    })
  })
  vi.mocked(apiClient.post).mockResolvedValue({ data: { state: 'queued' } })
})

function renderForm({
  count = 2,
  editing = false,
  pricingState = 'ready',
} = {}) {
  if (pricingState !== 'ready') {
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()!
    vi.mocked(apiClient.get).mockImplementation((url, ...args) => {
      if (url === '/pricing')
        return pricingState === 'loading'
          ? new Promise(() => {})
          : Promise.reject(new Error('Pricing unavailable'))
      return originalGet(url, ...args)
    })
  }
  const issued = cards.slice(0, count)
  const result: CreatedInvoice = {
    id: 'invoice-1',
    totalPrice: count * 50,
    giftCardRedeemed: 0,
    giftCards: issued,
  }
  const save = vi.fn().mockResolvedValue(result)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (pricingState === 'ready')
    client.setQueryData(['pricing'], {
      vatRate: 0.1,
      urgentCharge: null,
      customerMaterialBasePrice: null,
    })
  client.setQueryData(['default-location'], {
    defaultLocation: null,
    defaultLocationId: null,
  })
  render(
    <QueryClientProvider client={client}>
      <InvoiceForm
        defaultValues={{
          ...createEmptyInvoiceForm(),
          expectedVatRate: 0.1,
          customers: [],
          giftCards: issued.map((_, index) => ({
            ...createEmptyGiftCardLine(),
            amount: 50,
            boughtFor: preview(index).boughtFor,
            recipientPhone: preview(index).mobile,
          })),
        }}
        title="New invoice"
        subtitle="Gift card sale"
        saveVerb={editing ? 'Updating' : 'Saving'}
        savedVerb={editing ? 'updated' : 'saved'}
        mutation={{ mutateAsync: save, isPending: false }}
        editing={editing}
      />
    </QueryClientProvider>,
  )
  return save
}

describe('gift card delivery after creating an invoice', () => {
  it('previews and sends each purchased card before offering the invoice notification', async () => {
    const save = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    expect(await screen.findByText(preview(0).body)).toBeTruthy()
    expect(screen.getByText(/Invoice saved\. Gift card 1 of 2/)).toBeTruthy()
    expect(screen.getByText(/Recipient 1 · \+97333112233/)).toBeTruthy()
    expect(
      screen.getByRole('img', { name: `Gift card ${cards[0].code}` }),
    ).toBeTruthy()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.queryByText('invoice_created notification')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect(await screen.findByText(preview(1).body)).toBeTruthy()
    expect(screen.getByText(/Invoice saved\. Gift card 2 of 2/)).toBeTruthy()
    expect(screen.getByText(/Recipient 2 · \+97333998877/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect(await screen.findByText('invoice_created notification')).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      '/gift-cards/card-1/send',
      {
        sourceHash: 'source-card-1',
        requestId: expect.any(String),
      },
    )
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      '/gift-cards/card-2/send',
      {
        sourceHash: 'source-card-2',
        requestId: expect.any(String),
      },
    )
    const [first, second] = vi
      .mocked(apiClient.post)
      .mock.calls.map(([, body]) => body as { requestId: string })
    expect(first.requestId).not.toBe(second.requestId)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Finish notifications' }),
    )
    expect(navigate).toHaveBeenCalledWith({ to: '/invoices' })
  })

  it('retries a failed send without saving the invoice again or changing the send identity', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new Error('Delivery unavailable'),
    )
    const save = renderForm({ count: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await screen.findByText(preview(0).body)
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Delivery unavailable',
    )
    expect(screen.getByText('Save invoice')).toHaveProperty('disabled', true)
    expect(screen.queryByText('invoice_created notification')).toBeNull()
    const first = vi.mocked(apiClient.post).mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await screen.findByText('invoice_created notification')
    expect(vi.mocked(apiClient.post).mock.calls[1][1]).toEqual(first)
    expect(save).toHaveBeenCalledOnce()
  })

  it('can skip an unavailable card and still send the next card', async () => {
    firstCardUnavailable = true
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Card unavailable',
    )
    expect(
      screen.getByRole('button', { name: 'Send via WhatsApp' }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText(preview(1).body)
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }))
    await screen.findByText('invoice_created notification')
    expect(apiClient.post).toHaveBeenCalledOnce()
    expect(apiClient.post).toHaveBeenCalledWith('/gift-cards/card-2/send', {
      sourceHash: 'source-card-2',
      requestId: expect.any(String),
    })
  })

  it('does not offer delivery when invoice creation fails', async () => {
    const save = renderForm({ count: 1 })
    save.mockRejectedValueOnce(new Error('Could not save'))
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('invoice_created notification')).toBeNull()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps the gift card preview available when invoice PDF export fails', async () => {
    vi.mocked(downloadInvoicePdf).mockRejectedValueOnce(
      new Error('PDF unavailable'),
    )
    const save = renderForm({ count: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Export PDF' }))
    await screen.findByText(preview(0).body)
    expect(downloadInvoicePdf).toHaveBeenCalledWith('invoice-1')
    expect(screen.getByRole('link', { name: 'Download PNG' })).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('keeps invoice edits on the updated-invoice notification flow', async () => {
    renderForm({ count: 1, editing: true })
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await screen.findByText('invoice_updated notification')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      vi
        .mocked(apiClient.get)
        .mock.calls.some(([url]) => url.startsWith('/gift-cards/')),
    ).toBe(false)
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})

it('blocks saving while the VAT rate is loading', () => {
  const save = renderForm({ pricingState: 'loading' })
  expect(screen.getAllByText('Loading VAT pricing...').length).toBeGreaterThan(
    0,
  )
  const button = screen.getByRole('button', {
    name: 'Save invoice',
  })
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(save).not.toHaveBeenCalled()
})

it('blocks saving when the VAT rate cannot be loaded', async () => {
  const save = renderForm({ pricingState: 'error' })
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not load VAT pricing. Reload to try again.',
  )
  expect(screen.getByRole('button', { name: 'Save invoice' }).disabled).toBe(
    true,
  )
  expect(save).not.toHaveBeenCalled()
})

it('keeps saving blocked after a VAT conflict when cached pricing cannot refresh', async () => {
  const save = renderForm({ count: 1 })
  save.mockRejectedValueOnce(
    new ApiError(
      'VAT rate has changed. Refresh pricing and review the invoice before saving.',
      409,
    ),
  )
  const originalGet = vi.mocked(apiClient.get).getMockImplementation()!
  vi.mocked(apiClient.get).mockImplementation((url, ...args) =>
    url === '/pricing'
      ? Promise.reject(new Error('Pricing unavailable'))
      : originalGet(url, ...args),
  )
  vi.mocked(toast.promise).mockImplementation((pending, options) => {
    void Promise.resolve(pending).catch((error: unknown) => {
      if (typeof options?.error === 'function') options.error(error)
    })
    return 'vat-conflict'
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/pricing'))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'VAT pricing needs refreshing. Reload this invoice if pricing could not be refreshed.',
  )
  const button = screen.getByRole('button', { name: 'Save invoice' })
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(save).toHaveBeenCalledOnce()
})
