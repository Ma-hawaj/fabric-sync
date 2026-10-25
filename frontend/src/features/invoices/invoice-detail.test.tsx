import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceDetailPage } from './invoice-detail'
import type { InvoiceDetail } from './types/invoice-detail'
import { CONTEXT } from '@/features/returns/test-fixtures'
import type { ReturnContext } from '@/features/returns/types/returns'
import { STAFF_USER } from '@/features/users/test-fixtures'

const navigateMock = vi.fn()
vi.mock('@/features/notifications/notification-dialog', () => ({
  NotificationDialog: ({
    invoiceId,
    kind,
  }: {
    invoiceId: string | null
    kind: string
  }) =>
    invoiceId ? (
      <p>
        Preview {kind} for {invoiceId}
      </p>
    ) : null,
}))
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
  createdBy: null,
  id: 'inv-1',
  invoiceNumber: 42,
  collectionMethod: 'pickup',
  date: '2026-07-28T09:30:00Z',
  targetDate: '2026-08-04',
  createdAt: '2026-07-28T09:30:00Z',
  branchName: 'Manama Main Branch',
  buyer: null,
  paymentStatus: 'partial',
  paymentMethod: 'benefit',
  collected: false,
  orderCount: 1,
  collectedOrderCount: 0,
  lastCollectedAt: null,
  lines: [
    {
      kind: 'order',
      isUrgent: false,
      urgentCharge: 0,
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
      isUrgent: false,
      urgentCharge: 0,
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
  hasAdjustments: false,
  payments: [
    {
      id: 'pay-1',
      amount: 60,
      paymentType: 'benefit',
      recordedBy: null,
      paidAt: '2026-07-28T09:35:00Z',
      orderId: null,
    },
  ],
  totals: {
    urgentCharge: 0,
    subtotal: 100,
    discount: 0,
    discountUnit: 'amount',
    discountAmount: 0,
    taxable: 90.91,
    vatRate: 0.1,
    vat: 9.09,
    giftCardSales: 200,
    total: 300,
    giftCardRedeemed: 0,
    amountPaid: 60,
    amountCredited: 0,
    cashRefunded: 0,
    giftCardRefunded: 0,
    netTotal: 300,
    netAmountPaid: 60,
    netGiftCardRedeemed: 0,
    refundDue: 0,
    balanceDue: 240,
  },
}

function renderPage(
  detail: InvoiceDetail | null,
  adjustments: ReturnContext = CONTEXT,
) {
  const client = new QueryClient()
  client.setQueryData(['users'], [STAFF_USER])
  client.setQueryData(['invoices', 'inv-1', 'returns'], adjustments)
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
  it('resolves invoice creators and payment recorders to staff names', () => {
    renderPage({
      ...DETAIL,
      createdBy: STAFF_USER.id,
      payments: [{ ...DETAIL.payments[0], recordedBy: STAFF_USER.id }],
    })
    expect(screen.getByText('Created by:').textContent).toContain(
      STAFF_USER.name,
    )
    const history = screen.getByRole('table', { name: 'Payments and refunds' })
    expect(
      within(history).getByRole('row', { name: /Payment/ }).textContent,
    ).toContain(STAFF_USER.name)
    expect(screen.queryByText(STAFF_USER.id, { exact: true })).toBeNull()
  })

  it('shows an explicit fallback for imported invoices and payments without staff', () => {
    renderPage(DETAIL)
    expect(screen.getByText('Created by:').textContent).toContain(
      'Staff not recorded',
    )
    const history = screen.getByRole('table', { name: 'Payments and refunds' })
    expect(
      within(history).getByRole('row', { name: /Payment/ }).textContent,
    ).toContain('Staff not recorded')
  })

  it('shows delivery, priority, addresses, and the urgent charge on saved invoices', () => {
    renderPage({
      ...DETAIL,
      lines: [
        { ...DETAIL.lines[0], isUrgent: true, urgentCharge: 10 },
        DETAIL.lines[1],
      ],
      collectionMethod: 'delivery',
      buyer: {
        name: 'Buyer',
        mobileNo: '12345',
        address: 'Building 1, Road 2',
      },
      totals: {
        ...DETAIL.totals,
        urgentCharge: 10,
        total: 310,
        balanceDue: 250,
      },
    })
    expect(screen.getByRole('img', { name: 'Urgent order' })).toBeTruthy()
    expect(screen.getByText('Delivery')).toBeTruthy()
    expect(screen.getByText('Building 1, Road 2')).toBeTruthy()
    expect(screen.getByText('Urgent charges (incl. VAT)')).toBeTruthy()
    expect(screen.getByText(/Urgent charge for this order/)).toBeTruthy()
  })
  beforeEach(() => {
    navigateMock.mockClear()
  })

  it('opens a separate resend preview without editing the invoice', () => {
    renderPage(DETAIL)
    expect(screen.queryByText('Preview manual_resend for inv-1')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Resend invoice via WhatsApp' }),
    )
    expect(screen.getByText('Preview manual_resend for inv-1')).toBeTruthy()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('titles the page with the human-readable invoice number', () => {
    renderPage(DETAIL)

    expect(screen.queryByText('Invoice INV-42')).toBeTruthy()
    expect(screen.queryByText(/Manama Main Branch/)).toBeTruthy()
  })

  it('shows the promised target date next to the creation moment', () => {
    renderPage(DETAIL)

    expect(screen.queryByText(/Target/)).toBeTruthy()
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

    const summary = screen.getByRole('region', { name: 'Invoice Summary' })
    const row = (label: string) =>
      within(summary).getByText(label).closest('div')!.querySelector('dd')!
        .textContent
    expect(row('Total without VAT')).toBe('BHD 290.910')
    expect(row('VAT (10%)')).toBe('BHD 9.090')
    expect(row('Total incl. VAT')).toBe('BHD 300.000')
    expect(row('Balance due')).toBe('BHD 240.000')
    const breakdown = within(summary)
      .getByText('Price breakdown')
      .closest('details')!
    expect(breakdown.open).toBe(false)
    fireEvent.click(within(summary).getByText('Price breakdown'))
    expect(breakdown.open).toBe(true)
    expect(screen.queryByText('VAT (10%)')).toBeTruthy()
    expect(screen.queryByText('Gift cards sold')).toBeTruthy()
    expect(screen.queryByText('Balance due')).toBeTruthy()
  })

  it('lists the payment history with method and amount', () => {
    renderPage(DETAIL)

    expect(screen.queryByText('Payments & Refunds')).toBeTruthy()
    expect(screen.queryByText('benefit')).toBeTruthy()
    expect(screen.queryByText('Invoice payment')).toBeTruthy()
  })

  it('places pending gift-card refunds in payment history even without external payment entries', () => {
    renderPage(
      {
        ...DETAIL,
        payments: [],
        hasAdjustments: true,
        totals: {
          ...DETAIL.totals,
          total: 100,
          amountPaid: 0,
          giftCardRedeemed: 100,
          amountCredited: 30,
          netTotal: 70,
          netAmountPaid: 0,
          netGiftCardRedeemed: 100,
          refundDue: 30,
          balanceDue: 0,
        },
      },
      {
        ...CONTEXT,
        settlement: {
          ...CONTEXT.settlement,
          amountPaid: 0,
          amountCredited: 30,
          netTotal: 70,
          netAmountPaid: 0,
          netGiftCardRedeemed: 100,
          refundDue: 30,
        },
      },
    )
    const credits = screen.getByRole('region', {
      name: 'Returns & Cancellations',
    })
    const history = screen.getByRole('region', { name: 'Payments & Refunds' })
    expect(
      within(credits).queryByRole('button', { name: 'Refund Pending Credit' }),
    ).toBeNull()
    fireEvent.click(
      within(history).getByRole('button', { name: 'Refund Pending Credit' }),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Record Refund' })).toBeTruthy()
  })

  it('keeps the original sale and shows adjusted totals with negative refunds in payment history', () => {
    renderPage(
      {
        ...DETAIL,
        hasAdjustments: true,
        totals: {
          ...DETAIL.totals,
          total: 100,
          amountPaid: 80,
          giftCardRedeemed: 20,
          amountCredited: 30,
          cashRefunded: 10,
          giftCardRefunded: 20,
          netTotal: 70,
          netAmountPaid: 70,
          netGiftCardRedeemed: 0,
          balanceDue: 0,
        },
      },
      {
        ...CONTEXT,
        returns: [
          {
            id: 'return-1',
            reason: 'Garment returned',
            kind: 'return',
            amount: 30,
            createdAt: '2026-07-28T09:00:00Z',
            createdBy: STAFF_USER.id,
            lines: [
              {
                lineId: 'order-1',
                description: 'Japanese Toray Cotton',
                quantity: 1,
                amount: 30,
                restocked: false,
                originalLocationId: null,
                originalLocationName: null,
                restockLocationId: null,
                restockLocationName: null,
              },
            ],
          },
        ],
        refunds: [
          {
            id: 'r2',
            reason: 'Restore original card',
            amount: 20,
            paymentType: 'gift_card',
            giftCardCode: 'GC-1',
            adjustmentId: 'return-1',
            createdAt: '2026-07-28T12:00:00+03:00',
            createdBy: 'staff',
          },
          {
            id: 'r1',
            reason: 'Wrong size',
            amount: 10,
            paymentType: 'cash',
            giftCardCode: null,
            adjustmentId: 'return-1',
            createdAt: '2026-07-28T10:00:00Z',
            createdBy: 'staff',
          },
        ],
      },
    )
    const refundBreakdown = screen
      .getByText('Refund breakdown')
      .closest('details')!
    expect(refundBreakdown.open).toBe(false)
    fireEvent.click(screen.getByText('Refund breakdown'))
    expect(refundBreakdown.open).toBe(true)
    for (const label of [
      'Total incl. VAT',
      'After credits',
      'Net paid (all methods)',
    ]) {
      const row = screen.getByText(label).parentElement!
      expect(row.textContent).toMatch(
        label === 'Total incl. VAT' ? /100\.000/ : /70\.000/,
      )
    }
    const history = screen.getByRole('table', { name: 'Payments and refunds' })
    const rows = within(history).getAllByRole('row')
    expect(rows[1].textContent).toContain('Gift card GC-1')
    expect(rows[1].textContent).toMatch(/-BHD\s*20\.000/)
    expect(rows[2].textContent).toContain('Payment')
    expect(rows[3].textContent).toContain('Wrong size')
    expect(rows[3].textContent).toMatch(/-BHD\s*10\.000/)
    expect(rows[1].textContent).toContain(STAFF_USER.name)
    expect(rows[3].textContent).toContain(STAFF_USER.name)
    const credits = screen.getByRole('region', {
      name: 'Returns & Cancellations',
    })
    expect(credits.querySelectorAll('article')).toHaveLength(1)
    expect(within(credits).getByText('Garment returned')).toBeTruthy()
    expect(within(credits).queryByText('Wrong size')).toBeNull()
    expect(within(credits).queryByText('Restore original card')).toBeNull()
    expect(within(credits).getByText(STAFF_USER.name)).toBeTruthy()
    expect(
      within(credits)
        .getByRole('link', { name: 'View refund payments' })
        .getAttribute('href'),
    ).toBe('#refund-r2')
    expect(document.getElementById('refund-r2')).toBe(rows[1])
    expect(screen.queryByText('return-1')).toBeNull()
    expect(screen.queryByText(STAFF_USER.id)).toBeNull()
  })

  it('shows collection separately from payment and still allows editing with an advance taken', () => {
    renderPage({ ...DETAIL, collected: false })

    expect(screen.queryByText('Pending collection')).toBeTruthy()
    expect(screen.queryByText('Partially paid')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('marks a collected invoice collected and leaves edit validation to saving', () => {
    renderPage({
      ...DETAIL,
      collected: true,
    })

    expect(screen.queryByText('Collection complete')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('allows editing a retail-only invoice', () => {
    renderPage({
      ...DETAIL,
      collected: true,
      lines: [DETAIL.lines[1]],
    })
    expect(
      screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('keeps family members sharing a phone visible in the customer summary', () => {
    const first = DETAIL.lines[0]
    const second = {
      ...first,
      orderId: 'order-2',
      customer: { name: 'Omar', mobileNo: first.customer!.mobileNo },
    }
    renderPage({ ...DETAIL, lines: [first, second] })
    expect(screen.getAllByText('Omar')).toHaveLength(2)
    expect(screen.getAllByText('Ahmed Al-Mansoori')).toHaveLength(2)
  })

  it('protects the original sale after a return even when its credit was zero', () => {
    renderPage({ ...DETAIL, collected: false, hasAdjustments: true })
    expect(
      screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled'),
    ).toBe(true)
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
