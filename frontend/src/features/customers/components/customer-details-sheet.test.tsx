import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CustomerDetailsSheet } from './customer-details-sheet'
import type { Customer } from '../types/customers'

// The sheet header links to the edit page and each invoice row links to its
// invoice; stub Link so the tests don't need a router, keeping the href so
// the links stay assertable.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode
    params?: Record<string, string>
  }) => (
    <a
      href={
        params?.customerId
          ? `/customers/${params.customerId}/edit`
          : params?.invoiceId
            ? `/invoices/${params.invoiceId}`
            : '#'
      }
    >
      {children}
    </a>
  ),
}))

const CUSTOMER: Customer = {
  id: 'cust-1',
  name: 'Ahmed Al-Mansoori',
  mobileNo: '+971-50-1234567',
  measurements: [
    {
      id: 'meas-1',
      customerId: 'cust-1',
      date: new Date('2026-07-01'),
      chest: 108,
      sleeveLength: 62,
      foWidth: 8,
    },
  ],
  invoices: [
    {
      id: 'inv-1',
      invoiceNumber: 42,
      invoiceDate: new Date('2026-07-28'),
      targetDate: new Date('2026-08-04'),
      totalPrice: 300,
      paymentStatus: 'partial',
      balanceDue: 180,
    },
  ],
}

function renderSheet(customer: Customer | null) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <CustomerDetailsSheet customer={customer} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('CustomerDetailsSheet', () => {
  it('keeps every field of a shown group in place, leaving missing values empty', () => {
    renderSheet(CUSTOMER)

    expect(screen.queryByText('Body Dimensions')).toBeTruthy()
    expect(screen.queryByText('Style & Finishing')).toBeTruthy()
    expect(screen.queryByText('Pockets')).toBeTruthy()
    // Waist was not recorded, but its slot stays so the recorded fields
    // keep their grid positions.
    expect(screen.queryByText('Waist')).toBeTruthy()
    expect(screen.queryByText('108')).toBeTruthy()
    // Body Dimensions has 23 fields and 2 recorded values; Style &
    // Finishing has 2 fields and 1 recorded value; Pockets has 5 fields
    // and none recorded. Every other slot holds a placeholder.
    // (The sheet renders in a portal, so query the document body.)
    expect(document.body.querySelectorAll('[data-empty]').length).toBe(27)
  })

  it('draws the thob sketch alongside the measurements', () => {
    renderSheet(CUSTOMER)

    expect(
      screen.queryByLabelText(
        'Thob sketch, front view, with measurement guides',
      ),
    ).toBeTruthy()
  })

  it('shows the customer invoices with links to their pages', () => {
    renderSheet(CUSTOMER)

    expect(
      screen.queryByText('No invoices on file for this customer.'),
    ).toBeNull()
    const link = screen.getByRole('link', { name: 'INV-42' })
    expect(link.getAttribute('href')).toBe('/invoices/inv-1')
    expect(screen.queryByText('BHD 300.00')).toBeTruthy()
    expect(screen.queryByText('partial')).toBeTruthy()
  })

  it('shows an empty state for a customer with no invoices', () => {
    renderSheet({ ...CUSTOMER, invoices: [] })

    expect(
      screen.queryByText('No invoices on file for this customer.'),
    ).toBeTruthy()
  })
})
