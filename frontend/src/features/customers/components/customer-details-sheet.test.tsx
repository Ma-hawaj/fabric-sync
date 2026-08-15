import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
      cuffling: 'Cufflink',
    },
  ],
}

function renderSheet(customer: Customer | null) {
  const client = new QueryClient()
  client.setQueryData(['orders'], [])
  return render(
    <QueryClientProvider client={client}>
      <CustomerDetailsSheet customer={customer} onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe('CustomerDetailsSheet', () => {
  it('groups the recorded measurements and drops the empty groups', () => {
    renderSheet(CUSTOMER)

    expect(screen.queryByText('Body Dimensions')).toBeTruthy()
    expect(screen.queryByText('Style & Finishing')).toBeTruthy()
    // Nothing was recorded for any pocket field.
    expect(screen.queryByText('Pockets')).toBeNull()
    // Nor for the other body fields.
    expect(screen.queryByText('Waist')).toBeNull()
  })

  it('draws the thob sketch alongside the measurements', () => {
    renderSheet(CUSTOMER)

    expect(
      screen.queryByLabelText('Thob sketch with measurement guides'),
    ).toBeTruthy()
  })
})
