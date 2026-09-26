import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceEditPage } from './invoice-edit'
import type { InvoiceEdit } from './types/invoice-edit'

// Hoisted by vitest above these imports at transform time.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const EDIT_FIXTURE: InvoiceEdit = {
  id: '0197fdd2-6a67-7000-8000-000000000001',
  invoiceNumber: 42,
  date: '2026-07-19',
  branchId: null,
  branchName: null,
  discount: 10,
  discountUnit: 'amount',
  payments: [],
  customerId: null,
  customers: [],
  products: [],
  giftCards: [{ code: 'GC-1', amount: 150, expiresOn: null }],
  giftCardRedemptions: [],
}

function renderPage() {
  const client = new QueryClient()
  client.setQueryData(['invoices', EDIT_FIXTURE.id, 'edit'], EDIT_FIXTURE)
  return render(
    <QueryClientProvider client={client}>
      <InvoiceEditPage invoiceId={EDIT_FIXTURE.id} />
    </QueryClientProvider>,
  )
}

describe('InvoiceEditPage', () => {
  it('renders the loaded invoice in the shared form', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Edit Invoice INV-42' }),
    ).toBeTruthy()
    // The gift card sale reopened as a line with its code visible.
    expect(await screen.findByDisplayValue('GC-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('waits for the invoice rather than rendering an empty form', () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <InvoiceEditPage invoiceId="missing" />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Loading invoice...')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
