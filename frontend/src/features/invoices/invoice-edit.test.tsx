import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceEditPage } from './invoice-edit'
import type { InvoiceEdit } from './types/invoice-edit'
import { createEmptyMeasurement } from '@/features/customers/types/measurement-form'
import { measurementPayload } from '@/features/customers/hooks/use-create-customer'

// Hoisted by vitest above these imports at transform time.
const { save, navigate, eligibility } = vi.hoisted(() => ({
  save: vi.fn(),
  navigate: vi.fn(),
  eligibility: { canTrade: true, canCreateOrders: true },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('./hooks/use-update-invoice', () => ({
  useUpdateInvoice: () => ({ mutateAsync: save, isPending: false }),
}))
vi.mock('@/features/reports/hooks/use-sales-closing', () => ({
  useBranchDayStatus: () => ({
    data: {
      issuingBranchId: 'edit-counter',
      issuingBranchName: 'Edit counter',
      branchId: 'edit-counter',
      date: '2026-07-19',
      openingRecorded: true,
      closed: false,
      previousUnclosedDate: null,
      trackingStartDate: '2026-07-19',
      dailyCheckRequired: true,
      ...eligibility,
    },
    isPending: false,
    isError: false,
  }),
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
  eligibility.canTrade = true
  eligibility.canCreateOrders = true
})

const EDIT_FIXTURE: InvoiceEdit = {
  id: '0197fdd2-6a67-7000-8000-000000000001',
  invoiceNumber: 42,
  vatRate: 0.1,
  collectionMethod: 'pickup',
  urgentCharge: 0,
  date: '2026-07-19',
  targetDate: null,
  issuingBranchId: 'edit-counter',
  issuingBranchName: 'Edit counter',
  branchId: 'edit-counter',
  branchName: 'Edit counter',
  discount: 10,
  discountUnit: 'amount',
  payments: [],
  customerId: null,
  materials: [],
  customers: [],
  products: [],
  giftCards: [
    {
      code: 'GC-1',
      amount: 150,
      expiresOn: null,
      boughtFor: 'Recipient',
      recipientPhone: '+97333112233',
    },
  ],
  giftCardRedemptions: [],
}

function renderPage(edit: InvoiceEdit = EDIT_FIXTURE) {
  const client = new QueryClient()
  client.setQueryData(['invoices', EDIT_FIXTURE.id, 'edit'], edit)
  return render(
    <QueryClientProvider client={client}>
      <InvoiceEditPage invoiceId={EDIT_FIXTURE.id} />
    </QueryClientProvider>,
  )
}

describe('InvoiceEditPage', () => {
  it('allows an existing invoice edit when trading is open but the branch cannot create new orders', async () => {
    eligibility.canCreateOrders = false
    save.mockResolvedValue({ id: EDIT_FIXTURE.id, totalPrice: 140 })
    renderPage()
    const button = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Save invoice',
    })
    expect(button.disabled).toBe(false)
    expect(screen.queryByText(/Record today’s opening cash/)).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
  })
  it('saves an imported unknown-material order without selecting fabric or changing its price', async () => {
    save.mockResolvedValue({ id: EDIT_FIXTURE.id, totalPrice: 100 })
    renderPage({
      ...EDIT_FIXTURE,
      discount: 0,
      giftCards: [],
      customers: [
        {
          existingCustomerId: 'customer-1',
          customerNumber: 1,
          customerName: 'Ahmed',
          customerMobileNo: '+97333112233',
          measurementId: 'measurement-1',
          measurement: measurementPayload({
            ...createEmptyMeasurement(),
            date: '2026-11-09',
            type: 'body',
            fit: 'medium',
          }),
          orders: [
            {
              originalOrderId: 'order-1',
              materialSource: 'unknown',
              customerMaterialDescription: null,
              materialId: null,
              materialName: 'Unknown material',
              materialUnit: 'meters',
              materialAmount: 1,
              materialLocationId: null,
              materialLocationName: null,
              productionLocationId: 'workshop',
              productionLocationName: 'Workshop',
              stockQuantity: null,
              basePrice: 0,
              price: 100,
              isUrgent: false,
              urgentCharge: 0,
              thobeType: null,
              fPocket: null,
              sPocket: null,
              collar: null,
              sleeve: null,
              patti: null,
              emd: null,
              moreDetails: null,
            },
          ],
        },
      ],
    })
    expect(await screen.findByRole('radio', { name: 'Unknown' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save.mock.calls[0][0].customers[0].orders[0]).toMatchObject({
      originalOrderId: 'order-1',
      materialSource: 'unknown',
      materialId: '',
      materialLocationId: '',
      price: 100,
    })
  })

  it('offers an updated-invoice preview after saving and keeps the edit when skipped', async () => {
    save.mockResolvedValue({ id: EDIT_FIXTURE.id, totalPrice: 140 })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save invoice' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Save invoice' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(screen.queryByText('invoice_updated')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('renders the loaded invoice in the shared form', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Edit Invoice INV-42' }),
    ).toBeTruthy()
    // Issued codes stay read-only, and recipient details survive reopening.
    expect(await screen.findByText(/Code: GC-1/)).toBeTruthy()
    expect(screen.getByDisplayValue('Recipient')).toBeTruthy()
    expect(
      screen.getByRole('textbox', { name: 'Recipient phone' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save invoice' })).toBeTruthy()
  })

  it('waits for the invoice rather than rendering an empty form', () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <InvoiceEditPage invoiceId="missing" />
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Loading invoice...')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save invoice' })).toBeNull()
  })
})
