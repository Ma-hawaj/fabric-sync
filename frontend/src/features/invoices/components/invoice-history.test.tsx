import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceHistory } from './invoice-history'
import type { InvoiceHistoryEntry } from '../types/invoice-history'
import type { User } from '@/features/users/types/user'

const entries: InvoiceHistoryEntry[] = [
  { kind: 'created', at: '2026-11-01T09:00:00Z', actor: 'staff-1' },
  {
    kind: 'edited',
    id: 'edit-1',
    at: '2026-11-02T10:00:00Z',
    actor: 'staff-1',
    changes: [
      {
        path: 'header.targetDate',
        label: 'Target date',
        before: null,
        after: '2026-11-10',
      },
    ],
    totalBefore: 100,
    totalAfter: 100,
  },
  {
    kind: 'payment',
    id: 'pay-1',
    at: '2026-11-03T11:00:00Z',
    actor: 'staff-1',
    amount: 40,
    paymentType: 'cash',
    orderId: null,
  },
]

const users: User[] = [
  {
    id: 'staff-1',
    name: 'Aisha',
    email: null,
    avatarUrl: null,
    roles: [],
    groups: [],
  },
]

function setup() {
  const client = new QueryClient()
  client.setQueryData(['invoices', 'invoice-1', 'history'], entries)
  client.setQueryData(['users'], users)
  return render(
    <QueryClientProvider client={client}>
      <InvoiceHistory invoiceId="invoice-1" />
    </QueryClientProvider>,
  )
}

describe('InvoiceHistory', () => {
  it('renders creation, edit and payment events with the staff name', () => {
    setup()
    expect(screen.getByText('Invoice created')).toBeTruthy()
    expect(screen.getByText('Payment')).toBeTruthy()
    expect(screen.getAllByText('Aisha').length).toBeGreaterThan(0)
  })

  it('expands an edit to show the field-level diff', () => {
    setup()
    const toggle = screen.getByRole('button', { name: /Edited 1 field/ })
    expect(screen.queryByText('Target date')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Target date')).toBeTruthy()
    expect(screen.getByText('2026-11-10')).toBeTruthy()
  })

  it('shows an empty state when there is no history', () => {
    const client = new QueryClient()
    client.setQueryData(['invoices', 'invoice-1', 'history'], [])
    render(
      <QueryClientProvider client={client}>
        <InvoiceHistory invoiceId="invoice-1" />
      </QueryClientProvider>,
    )
    expect(screen.getByText('No history recorded.')).toBeTruthy()
  })
})
