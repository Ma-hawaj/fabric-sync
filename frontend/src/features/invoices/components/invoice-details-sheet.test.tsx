import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceDetailsSheet } from './invoice-details-sheet'
import type { Invoice } from '../types/invoices'
import type { InvoiceDetail } from '../types/invoice-detail'

const INVOICE: Invoice = {
  id: 'inv-1',
  date: '2026-07-28',
  customers: [{ name: 'Ahmed Al-Mansoori', mobileNo: '+973-3311-2233' }],
  itemCount: 3,
  materials: ['Japanese Toray Cotton'],
  totalPrice: 310,
  paymentStatus: 'partial',
  amountPaid: 60,
  advanceAmount: 60,
  advancePaymentType: 'benefit',
  finalPaymentType: null,
}

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

function renderSheet(detail: InvoiceDetail | null) {
  const client = new QueryClient()
  if (detail) {
    client.setQueryData(['invoices', INVOICE.id], detail)
  }
  return render(
    <QueryClientProvider client={client}>
      <InvoiceDetailsSheet invoice={INVOICE} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('InvoiceDetailsSheet', () => {
  it('titles the sheet with the human-readable invoice number', () => {
    renderSheet(DETAIL)

    expect(screen.queryByText('Invoice INV-42')).toBeTruthy()
  })

  it('lists every line with its specification and type', () => {
    renderSheet(DETAIL)

    expect(screen.queryByText('Japanese Toray Cotton')).toBeTruthy()
    expect(screen.queryByText('Thobe: Saudi · Collar: Classic')).toBeTruthy()
    expect(screen.queryByText('Tailoring')).toBeTruthy()
    expect(screen.queryByText('Gift card GC-2026-A1')).toBeTruthy()
    expect(screen.queryByText('Gift Card')).toBeTruthy()
  })

  it('shows the VAT rate and the balance still owed', () => {
    renderSheet(DETAIL)

    expect(screen.queryByText('VAT (10%)')).toBeTruthy()
    expect(screen.queryByText('Gift cards sold')).toBeTruthy()
    expect(screen.queryByText('Balance due')).toBeTruthy()
  })

  it('waits for the line items rather than rendering an empty invoice', () => {
    // The list row that opens the sheet carries no lines, so until the detail
    // query resolves there is nothing to show but the header.
    renderSheet(null)

    expect(screen.queryByText('Loading invoice details...')).toBeTruthy()
    expect(screen.queryByText('Balance due')).toBeNull()
  })
})
