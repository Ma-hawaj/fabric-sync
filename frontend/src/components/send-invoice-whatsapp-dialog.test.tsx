import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SendInvoiceWhatsAppDialog } from './send-invoice-whatsapp-dialog'
import {
  captureInvoiceImagePng,
  captureReadyCardImagePng,
} from '@/features/invoices/lib/capture-invoice-image'
import {
  printInvoiceDocument,
  printReadyCardDocument,
} from '@/features/invoices/lib/print-invoice'
import type { InvoiceDetail } from '@/features/invoices/types/invoice-detail'

vi.mock('@/features/invoices/lib/capture-invoice-image', () => ({
  captureInvoiceImagePng: vi.fn(),
  captureReadyCardImagePng: vi.fn(),
}))

vi.mock('@/features/invoices/lib/print-invoice', () => ({
  printInvoiceDocument: vi.fn(),
  printReadyCardDocument: vi.fn(),
}))

function detailWith(mobileNo: string): InvoiceDetail {
  return {
    id: 'inv-1',
    invoiceNumber: 42,
    date: '2026-07-28',
    createdAt: '2026-07-28T09:30:00Z',
    branchName: null,
    buyer: null,
    paymentStatus: 'partial',
    advanceAmount: 60,
    advancePaymentType: 'benefit',
    finalPaymentType: null,
    lines: [
      {
        kind: 'order',
        orderId: 'order-1',
        description: 'Japanese Toray Cotton',
        detail: 'Thobe: Saudi · Collar: Classic',
        customer: { name: 'Ahmed Al-Mansoori', mobileNo },
        quantity: 3.5,
        unit: 'm',
        unitPrice: 100,
        lineTotal: 100,
        taxable: true,
      },
    ],
    redemptions: [],
    totals: {
      subtotal: 100,
      discount: 0,
      discountUnit: 'amount',
      discountAmount: 0,
      taxable: 100,
      vatRate: 0.1,
      vat: 10,
      giftCardSales: 0,
      total: 110,
      giftCardRedeemed: 0,
      amountPaid: 60,
      balanceDue: 50,
    },
  }
}

function renderDialog(
  detail: InvoiceDetail,
  kind: 'created' | 'ready' | 'resent' = 'resent',
) {
  const client = new QueryClient()
  client.setQueryData(['invoices', detail.id], detail)
  return render(
    <QueryClientProvider client={client}>
      <SendInvoiceWhatsAppDialog
        invoiceId={detail.id}
        kind={kind}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  )
}

describe('SendInvoiceWhatsAppDialog', () => {
  beforeEach(() => {
    vi.mocked(captureInvoiceImagePng).mockReset()
    vi.mocked(captureInvoiceImagePng).mockResolvedValue(
      new Blob(['fake png'], { type: 'image/png' }),
    )
    vi.mocked(captureReadyCardImagePng).mockReset()
    vi.mocked(captureReadyCardImagePng).mockResolvedValue(
      new Blob(['fake png'], { type: 'image/png' }),
    )
  })

  it('previews the exact invoice image that will be sent, and offers Send', async () => {
    const detail = detailWith('+973-3311-2233')
    renderDialog(detail, 'resent')

    expect(await screen.findByAltText('Invoice preview')).toBeTruthy()
    expect(screen.queryByText(/INV-42/)).toBeTruthy()
    expect(screen.queryByText('Invoice Total')).toBeTruthy()
    expect(screen.queryByText(/3311-2233/)).toBeTruthy()

    const send = screen.getByRole('button', {
      name: 'Send via WhatsApp',
    })
    expect(send.disabled).toBe(false)
    expect(vi.mocked(captureInvoiceImagePng)).toHaveBeenCalledWith(detail.id)
    expect(vi.mocked(captureReadyCardImagePng)).not.toHaveBeenCalled()
  })

  it('previews the ready-for-collection card instead of the invoice', async () => {
    const detail = detailWith('+973-3311-2233')
    renderDialog(detail, 'ready')

    expect(await screen.findByAltText('Ready card preview')).toBeTruthy()
    const description = screen.getByText(/INV-42/)
    expect(description.textContent).toContain('ready for collection')
    expect(description.textContent).toContain('ready-for-collection card')

    const send = screen.getByRole('button', { name: 'Send via WhatsApp' })
    expect(send.disabled).toBe(false)
    expect(vi.mocked(captureReadyCardImagePng)).toHaveBeenCalledWith(detail.id)
    expect(vi.mocked(captureInvoiceImagePng)).not.toHaveBeenCalled()
  })

  it('opens the ready card as a PDF, not the invoice, in ready mode', async () => {
    const detail = detailWith('+973-3311-2233')
    renderDialog(detail, 'ready')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Preview as PDF' }),
    )
    await waitFor(() =>
      expect(vi.mocked(printReadyCardDocument)).toHaveBeenCalledWith(detail.id),
    )
    expect(vi.mocked(printInvoiceDocument)).not.toHaveBeenCalled()
  })

  it('also offers the PDF so the operator can review a printable copy', async () => {
    renderDialog(detailWith('+973-3311-2233'))

    expect(
      await screen.findByRole('button', { name: 'Preview as PDF' }),
    ).toBeTruthy()
  })

  it('blocks the send, and says why, when no one on the invoice has a phone', async () => {
    renderDialog(detailWith(''))

    expect(
      await screen.findByText(
        'No phone number on file for this customer — nothing to send the invoice to.',
      ),
    ).toBeTruthy()

    const send = screen.getByRole('button', { name: 'Send via WhatsApp' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
  })
})
