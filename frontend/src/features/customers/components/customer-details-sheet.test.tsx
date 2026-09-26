import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { listResponse } from '@/lib/list-fixtures'
import { CustomerDetailsSheet } from './customer-details-sheet'
import type { Customer } from '../types/customers'

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
}

function renderSheet(customer: Customer | null) {
  const client = new QueryClient()
  client.setQueryData(['orders', ''], listResponse([]))
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
    // Body Dimensions has 13 fields and 2 recorded values; Style &
    // Finishing is fully recorded. Every other slot holds a placeholder.
    // (The sheet renders in a portal, so query the document body.)
    expect(document.body.querySelectorAll('[data-empty]').length).toBe(15)
  })

  it('draws the thob sketch alongside the measurements', () => {
    renderSheet(CUSTOMER)

    expect(
      screen.queryByLabelText(
        'Thob sketch, front view, with measurement guides',
      ),
    ).toBeTruthy()
  })
})
