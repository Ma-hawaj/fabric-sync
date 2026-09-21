import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceDetailPage } from './invoice-detail'
import type { InvoiceDetail } from './types/invoice-detail'

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const DETAIL: InvoiceDetail = {
  id: 'inv-1',
  invoiceNumber: 42,
  date: '2026-07-28',
  createdAt: '2026-07-28T09:30:00Z',
  branchName: 'Manama Main Branch',
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
      customer: { name: 'Ahmed Al-Mansoori', mobileNo: '+973-3311-2233' },
      quantity: 3.5,
      unit: 'm',
      unitPrice: 100,
      lineTotal: 100,
      taxable: true,
    },
    {
      kind: 'gift_card',
      orderId: null,
      description: 'Gift card GC-2026-A1',
      detail: null,
      customer: null,
      quantity: 1,
      unit: null,
      unitPrice: 200,
      lineTotal: 200,
      taxable: false,
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
    giftCardSales: 200,
    total: 310,
    giftCardRedeemed: 0,
    amountPaid: 60,
    balanceDue: 250,
  },
}

function renderPage(detail: InvoiceDetail | null) {
  const client = new QueryClient()
  if (detail) {
    client.setQueryData(['invoices', detail.id], detail)
  }
  return render(
    <QueryClientProvider client={client}>
      <InvoiceDetailPage invoiceId="inv-1" />
    </QueryClientProvider>,
  )
}

describe('InvoiceDetailPage', () => {
  beforeEach(() => {
    navigateMock.mockClear()
  })

  it('titles the page with the human-readable invoice number', () => {
    renderPage(DETAIL)

    expect(screen.queryByText('Invoice INV-42')).toBeTruthy()
    expect(screen.queryByText(/Manama Main Branch/)).toBeTruthy()
  })

  it('lists every line with its specification and type', () => {
    renderPage(DETAIL)

    expect(screen.queryByText('Japanese Toray Cotton')).toBeTruthy()
    expect(screen.queryByText('Thobe: Saudi · Collar: Classic')).toBeTruthy()
    expect(screen.queryByText('Tailoring')).toBeTruthy()
    expect(screen.queryByText('Gift card GC-2026-A1')).toBeTruthy()
    expect(screen.queryByText('Gift Card')).toBeTruthy()
  })

  it('shows the VAT rate and the balance still owed', () => {
    renderPage(DETAIL)

    expect(screen.queryByText('VAT (10%)')).toBeTruthy()
    expect(screen.queryByText('Gift cards sold')).toBeTruthy()
    expect(screen.queryByText('Balance due')).toBeTruthy()
  })

  it('waits for the line items rather than rendering an empty invoice', () => {
    renderPage(null)

    expect(screen.queryByText('Loading invoice details...')).toBeTruthy()
    expect(screen.queryByText('Balance due')).toBeNull()
  })

  it("sends a tailoring line to that order's detail page", () => {
    renderPage(DETAIL)

    fireEvent.click(screen.getByText('Japanese Toray Cotton'))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/orders/$orderId',
      params: { orderId: 'order-1' },
    })
  })

  it('does not wire up a click for a gift card line, which has no order', () => {
    renderPage(DETAIL)

    fireEvent.click(screen.getByText('Gift card GC-2026-A1'))

    expect(navigateMock).not.toHaveBeenCalled()
  })
})
