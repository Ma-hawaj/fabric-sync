import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/data-table'
import { apiClient } from '@/lib/api'
import { apiGetMock } from '@/lib/list-fixtures'
import type { Invoice } from '../types/invoices'
import { getInvoiceColumns } from './invoice-columns'
import { InvoiceOrderBreakdown } from './invoice-order-breakdown'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode
    to: string
    params: Record<string, string>
  }) => <a href={to.replace(/\$\w+/, Object.values(params)[0])}>{children}</a>,
}))

const invoice: Invoice = {
  id: 'invoice-one',
  invoiceNumber: 42,
  collectionMethod: 'pickup',
  urgentCharge: 0,
  date: '2026-10-17T10:00:00Z',
  targetDate: null,
  customers: [
    { name: 'Ahmed', mobileNo: '+97333112233' },
    { name: 'Omar', mobileNo: '+97333445566' },
  ],
  itemCount: 4,
  materials: ['Cotton', 'Linen'],
  totalPrice: 90,
  paymentStatus: 'partial',
  amountPaid: 30,
  balanceDue: 60,
  paymentMethod: 'cash',
  giftCardRedeemed: 0,
  collected: false,
  orderCount: 3,
  collectedOrderCount: 1,
  lastCollectedAt: '2026-10-17T11:00:00Z',
  receivingLocation: 'Manama',
  productionLocations: ['Factory'],
}
const orders = [
  {
    id: 'a1',
    orderNumber: 101,
    invoiceId: invoice.id,
    customerName: 'Ahmed',
    customerMobile: '+97333112233',
    material: 'White cotton',
    materialAmount: 3,
    price: 20,
    status: 'collected',
    productionLocation: 'Factory',
  },
  {
    id: 'a2',
    orderNumber: 102,
    invoiceId: invoice.id,
    customerName: 'Ahmed',
    customerMobile: '+97333112233',
    material: 'Blue cotton',
    materialAmount: 3.5,
    price: 25,
    status: 'pending',
    productionLocation: 'Factory',
  },
  {
    id: 'b1',
    orderNumber: 103,
    invoiceId: invoice.id,
    customerName: 'Omar',
    customerMobile: '+97333445566',
    material: 'Linen',
    materialAmount: 4,
    price: 35,
    status: 'pending',
    productionLocation: null,
  },
  {
    id: 'other',
    orderNumber: 104,
    invoiceId: 'invoice-two',
    customerName: 'Other customer',
    customerMobile: '9999',
    material: 'Other material',
    materialAmount: 4,
    price: 35,
    status: 'pending',
    productionLocation: null,
  },
]
const columns = getInvoiceColumns(
  [],
  [],
  [],
  vi.fn(),
  vi.fn(),
  vi.fn(),
  vi.fn(),
  vi.fn(),
)
function InvoiceTable({ data = [invoice] }: { data?: Invoice[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    getRowCanExpand: (row) => row.original.orderCount > 0,
    manualExpanding: true,
    initialState: { columnVisibility: { customerMobile: false } },
  })
  return (
    <DataTable
      table={table}
      renderExpandedRow={(row) => (
        <InvoiceOrderBreakdown invoiceId={row.original.id} />
      )}
    />
  )
}
function renderTable(data?: Invoice[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <InvoiceTable data={data} />
    </QueryClientProvider>,
  )
  return { ...view, client }
}

describe('Invoice table', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset()
    vi.mocked(apiClient.get).mockImplementation(
      apiGetMock({ '/orders': orders }),
    )
  })
  it('keeps one invoice row with paired, stacked customer names and phones', () => {
    renderTable()
    expect(screen.getAllByRole('row')).toHaveLength(2)
    for (const customer of invoice.customers) {
      expect(
        within(screen.getByText(customer.name).parentElement!).getByText(
          customer.mobileNo,
        ),
      ).toBeTruthy()
    }
    expect(
      screen.queryByRole('columnheader', { name: 'Customer Mobile' }),
    ).toBeNull()
    expect(screen.getByText('1 of 3 collected')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'INV-42' })).toBeTruthy()
    expect(screen.getByText(/of.*records/, { exact: false })).toBeTruthy()
    expect(apiClient.get).not.toHaveBeenCalled()
  })
  it('loads only this invoice’s orders on expansion and groups them by customer', async () => {
    renderTable()
    const toggle = screen.getByRole('button', {
      name: 'Show orders for invoice INV-42',
    })
    fireEvent.click(toggle)
    expect(screen.getByRole('status').textContent).toBe('Loading orders...')
    const ahmed = (
      await screen.findByRole('link', { name: 'ORD-101' })
    ).closest('section')!
    expect(within(ahmed).getByRole('heading', { name: 'Ahmed' })).toBeTruthy()
    expect(within(ahmed).getByRole('link', { name: 'ORD-102' })).toBeTruthy()
    expect(within(ahmed).queryByRole('link', { name: 'ORD-103' })).toBeNull()
    expect(within(ahmed).getByText('BHD 45.000')).toBeTruthy()
    expect(within(ahmed).getByText('Collected')).toBeTruthy()
    expect(within(ahmed).getByText('In progress')).toBeTruthy()
    expect(within(ahmed).getByText('White cotton')).toBeTruthy()
    expect(within(ahmed).getByText('Blue cotton')).toBeTruthy()
    const omar = screen
      .getByRole('link', { name: 'ORD-103' })
      .closest('section')!
    expect(within(omar).getByRole('heading', { name: 'Omar' })).toBeTruthy()
    expect(screen.queryByText('Other customer')).toBeNull()
    const url = new URL(
      vi.mocked(apiClient.get).mock.calls[0][0],
      'http://localhost',
    )
    expect(JSON.parse(url.searchParams.get('filters')!)).toEqual([
      { id: 'invoiceId', value: invoice.id, variant: 'text', operator: 'eq' },
    ])
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/of.*records/, { exact: false })).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(
      screen.queryByRole('region', { name: 'Invoice order breakdown' }),
    ).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })
  it('marks only urgent orders in the breakdown and includes their fee once', async () => {
    vi.mocked(apiClient.get).mockImplementation(
      apiGetMock({
        '/orders': orders.map((order) => ({
          ...order,
          isUrgent: order.id === 'a2',
          urgentCharge: order.id === 'a2' ? 5 : 0,
        })),
      }),
    )
    renderTable()
    expect(screen.queryByRole('img', { name: 'Urgent order' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show orders/ }))
    const urgent = (
      await screen.findByRole('link', { name: 'ORD-102' })
    ).closest('tr')!
    const regular = screen.getByRole('link', { name: 'ORD-101' }).closest('tr')!
    expect(
      within(urgent).getByRole('img', { name: 'Urgent order' }),
    ).toBeTruthy()
    expect(
      within(regular).queryByRole('img', { name: 'Urgent order' }),
    ).toBeNull()
    expect(within(urgent).getByText('BHD 30.000')).toBeTruthy()
    expect(
      within(urgent).getByText(/Includes BHD 5.000 urgent charge/),
    ).toBeTruthy()
    expect(
      within(urgent.closest('section')!).getByText('BHD 50.000'),
    ).toBeTruthy()
  })
  it.each([
    [0, 3],
    [3, 3],
    [0, 0],
  ])(
    'shows collection progress for %i of %i tailoring orders',
    (collected, count) => {
      renderTable([
        {
          ...invoice,
          orderCount: count,
          collectedOrderCount: collected,
          collected: collected === count,
        },
      ])
      expect(
        screen.getByText(
          count ? `${collected} of ${count} collected` : 'No tailoring orders',
        ),
      ).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: /Show orders/ }) !== null,
      ).toBe(count > 0)
    },
  )
  it('shows failures and retries the breakdown instead of showing an empty invoice', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'))
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Show orders/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(
      screen.queryByText('No tailoring orders on this invoice.'),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'ORD-101' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps expansion on the same invoice when the rows are reordered', async () => {
    const second = { ...invoice, id: 'invoice-two' }
    const view = renderTable([invoice, second])
    fireEvent.click(screen.getAllByRole('button', { name: /Show orders/ })[0])
    await screen.findByRole('link', { name: 'ORD-101' })
    view.rerender(
      <QueryClientProvider client={view.client}>
        <InvoiceTable data={[second, invoice]} />
      </QueryClientProvider>,
    )
    expect(
      screen
        .getAllByRole('button', { name: /orders for invoice/ })
        .map((button) => button.getAttribute('aria-expanded')),
    ).toEqual(['false', 'true'])
    expect(screen.queryByRole('link', { name: 'ORD-104' })).toBeNull()
  })
})
