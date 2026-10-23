import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceEditPage } from './invoice-edit'
import type { InvoiceEdit } from './types/invoice-edit'

// Hoisted by vitest above these imports at transform time.
const { save, navigate } = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('./hooks/use-update-invoice', () => ({
  useUpdateInvoice: () => ({ mutateAsync: save, isPending: false }),
}))
vi.mock('@/features/notifications/notification-dialog', () => ({
  NotificationDialog: ({
    invoiceId,
    kind,
    onClose,
  }: {
    invoiceId: string | null
    kind: string
    onClose: () => void
  }) =>
    invoiceId ? (
      <div>
        {kind}
        <button onClick={onClose}>Not now</button>
      </div>
    ) : null,
}))

beforeEach(() => {
  save.mockReset()
  navigate.mockReset()
})

const EDIT_FIXTURE: InvoiceEdit = {
  id: '0197fdd2-6a67-7000-8000-000000000001',
  invoiceNumber: 42,
  collectionMethod: 'pickup',
  urgentCharge: 0,
  date: '2026-07-19',
  targetDate: null,
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
  it('offers an updated-invoice preview after saving and keeps the edit when skipped', async () => {
    save.mockResolvedValue({ id: EDIT_FIXTURE.id, totalPrice: 140 })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('invoice_updated')).toBeTruthy()
    expect(save).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/invoices' }),
    )
  })

  it('keeps a failed edit open without offering to resend it', async () => {
    save.mockRejectedValue(new Error('Save failed'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(screen.queryByText('invoice_updated')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

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
