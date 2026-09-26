import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrderDetailPage } from './order-detail'
import type { OrderDetail } from './types/orders'

vi.mock('@tanstack/react-router', () => ({
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

// The tracking panel queries locations and staff on its own; without a live
// backend they come back empty so the pickers render with nothing selected.
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}))

const ORDER: OrderDetail = {
  id: 'order-1',
  orderNumber: 7,
  invoiceId: 'inv-1',
  invoiceDate: new Date('2026-07-28'),
  measurementId: 'm-1',
  customerName: 'Ahmed Al-Mansoori',
  customerMobile: '+973-3311-2233',
  material: 'Japanese Toray Cotton',
  materialAmount: 3.5,
  price: 100,
  status: 'pending',
  productionLocationId: null,
  productionLocation: null,
  productionLocationInferred: false,
  receivingLocationId: 'branch-1',
  receivingLocation: 'Manama Main Branch',
  invoiceNumber: 42,
  stages: [
    {
      stageId: 'stage-1',
      name: 'Cutting',
      sortOrder: 1,
      requiresDelivery: false,
      applicable: true,
      status: 'done',
      startedAt: '2026-07-28T00:00:00Z',
      completedAt: '2026-07-28T10:00:00Z',
      locationId: null,
      location: null,
      notes: null,
      assigneeId: null,
      assigneeName: null,
    },
  ],
  currentStage: 'Sewing',
  repairs: [],
  invoiceTotalPrice: 300,
  invoiceAmountPaid: 120,
  invoicePaymentStatus: 'partial',
  invoiceAdvanceAmount: 120,
  invoiceAdvancePaymentType: 'benefit',
  invoiceFinalPaymentType: null,
  measurement: {
    id: 'm-1',
    customerId: 'c-1',
    date: new Date('2026-07-28'),
    lengthFl: 120,
    chest: 50,
  },
}

function renderPage() {
  const client = new QueryClient()
  client.setQueryData(['orders', ORDER.id], ORDER)
  return render(
    <QueryClientProvider client={client}>
      <OrderDetailPage orderId="order-1" />
    </QueryClientProvider>,
  )
}

const DELIVERY_STAGE = {
  stageId: 'stage-2',
  name: 'Location delivery',
  sortOrder: 2,
  requiresDelivery: true,
  applicable: true,
  status: 'pending',
  startedAt: '2026-07-28T10:00:00Z',
  completedAt: null,
  locationId: null,
  location: null,
  notes: null,
  assigneeId: null,
  assigneeName: null,
} as const

function renderDeliveryOrder(overrides: Partial<OrderDetail> = {}) {
  const order: OrderDetail = {
    ...ORDER,
    id: 'order-2',
    productionLocationId: 'branch-2',
    productionLocation: 'Muharraq Store',
    stages: [...ORDER.stages, { ...DELIVERY_STAGE }],
    currentStage: 'Location delivery',
    ...overrides,
  }
  const client = new QueryClient()
  client.setQueryData(['orders', order.id], order)
  return render(
    <QueryClientProvider client={client}>
      <OrderDetailPage orderId={order.id} />
    </QueryClientProvider>,
  )
}

describe('OrderDetailPage', () => {
  it('titles the page with the human-readable order number', () => {
    renderPage()

    expect(screen.queryByText('Order ORD-7')).toBeTruthy()
    // The parent invoice's number stays alongside as context.
    expect(screen.queryByText('INV-42')).toBeTruthy()
    expect(screen.queryByText('Manama Main Branch')).toBeTruthy()
  })

  it('shows the customer and the material the order was cut from', () => {
    renderPage()

    expect(screen.queryByText('Ahmed Al-Mansoori')).toBeTruthy()
    expect(screen.queryByText('Japanese Toray Cotton')).toBeTruthy()
    expect(screen.queryByText('3.5 m')).toBeTruthy()
  })

  it('lists the measurement the garment was cut to', () => {
    renderPage()

    // Group title and the two recorded values.
    expect(screen.queryByText('Body Dimensions')).toBeTruthy()
    expect(screen.queryByText('Length (Front)')).toBeTruthy()
    expect(screen.queryByText('120')).toBeTruthy()
    expect(screen.queryByText('Chest')).toBeTruthy()
    expect(screen.queryByText('50')).toBeTruthy()

    // The measurement template draws the thob from both silhouettes.
    expect(screen.queryByText('Front of Thob')).toBeTruthy()
    expect(screen.queryByText('Back of Thob')).toBeTruthy()
    expect(screen.queryByText('120 inch · Front Length')).toBeTruthy()
  })

  it('renders the production checklist with its stages', () => {
    renderPage()

    expect(screen.queryByText('Production')).toBeTruthy()
    expect(screen.queryByText('Cutting')).toBeTruthy()
    expect(screen.queryByText('Sewing')).toBeTruthy()
  })

  it('offers the export button', () => {
    renderPage()

    expect(screen.queryByText('Export PDF')).toBeTruthy()
  })

  it('waits for the detail rather than rendering an empty page', () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <OrderDetailPage orderId="order-1" />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Loading order...')).toBeTruthy()
    expect(screen.queryByText('Order ORD-7')).toBeNull()
  })

  it('sends a delivery to the receiving branch with no destination picker', () => {
    renderDeliveryOrder()

    expect(screen.queryByText('Delivers to Manama Main Branch.')).toBeTruthy()
    expect(screen.queryByText('Deliver To')).toBeNull()

    const done = screen.getByRole('button', { name: 'Done' })
    expect((done as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks a delivery while the receiving branch is unknown', () => {
    renderDeliveryOrder({
      receivingLocationId: null,
      receivingLocation: null,
    })

    expect(
      screen.queryByText(
        'Set a receiving branch on the invoice before completing this delivery.',
      ),
    ).toBeTruthy()

    const done = screen.getByRole('button', { name: 'Done' })
    expect((done as HTMLButtonElement).disabled).toBe(true)
  })
})
