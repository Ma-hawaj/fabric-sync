import { describe, expect, it, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InvoiceForm, InvoiceFormPage } from './invoice-form'

import { createEmptyInvoiceForm, createEmptyOrder } from './types/invoice-form'
import type { InvoiceFormValues } from './types/invoice-form'
import { apiGetMock } from '@/lib/list-fixtures'

// Hoisted by vitest above these imports at transform time.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/features/notifications/notification-dialog', () => ({
  NotificationDialog: ({ invoiceId }: { invoiceId: string | null }) =>
    invoiceId ? <p>Invoice saved</p> : null,
}))
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiBaseUrl: '/api',
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function clientForForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['design-options', ''], {
    data: [],
    page: 1,
    perPage: 100,
    total: 0,
    pageCount: 1,
  })
  client.setQueryData(['pricing'], {
    urgentCharge: { amount: 5, unit: 'amount' },
    customerMaterialBasePrice: 20,
  })
  client.setQueryData(['default-location'], {
    defaultLocation: null,
    defaultLocationId: null,
  })
  apiGet.mockImplementation(
    apiGetMock({
      '/customers': [],
      '/locations': [],
      '/materials': [],
      '/products': [],
    }),
  )
  return client
}

function renderPage() {
  return render(
    <QueryClientProvider client={clientForForm()}>
      <InvoiceFormPage />
    </QueryClientProvider>,
  )
}

function validInvoice(): InvoiceFormValues {
  const values = createEmptyInvoiceForm()
  values.customers[0].existingCustomerId = 'customer-1'
  values.customers[0].measurement.type = 'body'
  values.customers[0].measurement.fit = 'medium'
  values.customers[0].orders[0] = {
    ...createEmptyOrder(),
    materialSource: 'customer',
    customerMaterialDescription: 'White linen',
    materialAmount: 3.5,
    productionLocationId: 'workshop',
    price: 20,
  }
  return values
}

function renderInvoice(values = validInvoice()) {
  const save = vi
    .fn()
    .mockResolvedValue({ id: 'saved-invoice', totalPrice: 40 })
  render(
    <QueryClientProvider client={clientForForm()}>
      <InvoiceForm
        defaultValues={values}
        title="New Invoice"
        subtitle="Build the order, then review and save."
        saveVerb="Saving"
        savedVerb="saved"
        mutation={{ mutateAsync: save, isPending: false }}
      />
    </QueryClientProvider>,
  )
  return save
}

describe('InvoiceFormPage validation (zod + TanStack Form)', () => {
  it('requires a target date for an urgent order and clears the error when that order becomes regular', async () => {
    const values = validInvoice()
    values.customers[0].orders.push({
      ...values.customers[0].orders[0],
      key: crypto.randomUUID(),
    })
    const save = renderInvoice(values)
    const firstOrderUrgency = screen.getByLabelText('Urgent order 1', {
      selector: '[role="switch"]',
    })
    const secondOrderUrgency = screen.getByLabelText('Urgent order 2', {
      selector: '[role="switch"]',
    })
    const saveButton = screen.getByRole('button', { name: 'Save invoice' })

    fireEvent.click(firstOrderUrgency)
    expect(firstOrderUrgency.getAttribute('aria-checked')).toBe('true')
    expect(secondOrderUrgency.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(saveButton)

    expect(
      await screen.findByText('Pick a target date for urgent orders.'),
    ).toBeTruthy()
    expect(
      screen
        .getByLabelText('Target Date (required)')
        .getAttribute('aria-invalid'),
    ).toBe('true')
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(firstOrderUrgency)
    await waitFor(() => {
      expect(
        screen.queryByText('Pick a target date for urgent orders.'),
      ).toBeNull()
    })
    expect(screen.getByLabelText('Target Date (optional)')).toBeTruthy()
    expect(secondOrderUrgency.getAttribute('aria-checked')).toBe('false')
  })

  it('shows the zod error inline on the field and a banner, blocking submit', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))

    expect(
      await screen.findByText(
        'Pick an existing customer or switch to "+ New Customer".',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Please fix the highlighted fields before saving.'),
    ).toBeTruthy()
  })

  it('clears the error on the next submit attempt once the field is fixed', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await screen.findByText(
      'Pick an existing customer or switch to "+ New Customer".',
    )

    // Switch to a new adult customer with a name and phone — now valid,
    // aside from still needing a material/quantity on the order.
    fireEvent.click(screen.getByText('+ New Customer'))
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Ahmed Al-Mansoori' },
    })
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '+971-50-1234567' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))

    expect(
      screen.queryByText(
        'Pick an existing customer or switch to "+ New Customer".',
      ),
    ).toBeNull()
    expect(
      await screen.findByText('Pick a material and quantity.'),
    ).toBeTruthy()
  })
})

describe('Invoice workspace', () => {
  it('keeps optional sections out of the initial workspace until added', () => {
    renderInvoice()
    expect(screen.queryByRole('region', { name: 'Products' })).toBeNull()
    expect(
      screen.queryByRole('region', { name: 'Gift cards for sale' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add Product' }))
    expect(screen.getByRole('region', { name: 'Products' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sell a Gift Card' }))
    expect(
      screen.getByRole('region', { name: 'Gift cards for sale' }),
    ).toBeTruthy()
  })

  it('duplicates an order, opens only its editor, and preserves both lines on save', async () => {
    const values = validInvoice()
    const originalKey = values.customers[0].orders[0].key
    const save = renderInvoice(values)
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order 1' }))
    expect(
      within(screen.getByRole('region', { name: 'Order 1' })).queryByRole(
        'button',
        { name: 'Choose Collar' },
      ),
    ).toBeNull()
    expect(
      within(screen.getByRole('region', { name: 'Order 2' })).getByRole(
        'button',
        { name: 'Choose Collar' },
      ),
    ).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByText('Subtotal (incl. VAT)').parentElement?.textContent,
      ).toContain('40.00'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    const saved = save.mock.calls[0][0] as InvoiceFormValues
    expect(saved.customers[0].orders).toHaveLength(2)
    expect(saved.customers[0].orders[0].key).toBe(originalKey)
    expect(saved.customers[0].orders[1].key).not.toBe(originalKey)
    expect(saved.customers[0].orders[1]).toMatchObject({
      customerMaterialDescription: 'White linen',
      materialAmount: 3.5,
      price: 20,
    })
  })

  it('opens a collapsed invalid order and focuses its first issue when saving', async () => {
    const values = validInvoice()
    values.customers[0].orders[0].customerMaterialDescription = ''
    const save = renderInvoice(values)
    fireEvent.click(screen.getByRole('button', { name: 'Add Another Order' }))
    expect(
      within(screen.getByRole('region', { name: 'Order 1' })).queryByRole(
        'button',
        { name: 'Choose Collar' },
      ),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Order 1' })).getByRole(
          'button',
          { name: 'Choose Collar' },
        ),
      ).toBeTruthy(),
    )
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(
        'customers[0].orders[0].customerMaterialDescription',
      ),
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('opens missing measurement details even when staff have hidden them', async () => {
    const values = validInvoice()
    values.customers[0].measurement.type = ''
    const save = renderInvoice(values)
    fireEvent.click(screen.getByRole('button', { name: 'Hide measurements' }))
    expect(screen.queryByRole('radio', { name: 'Body' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
    expect(await screen.findByRole('radio', { name: 'Body' })).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement?.closest('[role="radiogroup"]')?.id).toBe(
        'customers[0].measurement.type',
      ),
    )
    expect(save).not.toHaveBeenCalled()
  })
})

it('adds direct material lines after removing the tailoring customer block', async () => {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Remove customer 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Material' }))
  expect(screen.getByLabelText('Material')).toBeTruthy()
  expect(screen.getByLabelText('Sold From')).toBeTruthy()
  expect(screen.queryByText('Pick where this order is made.')).toBeNull()
  fireEvent.change(screen.getByLabelText('Quantity'), {
    target: { value: '2.5' },
  })
  fireEvent.change(screen.getByLabelText(/Price per unit/), {
    target: { value: '11' },
  })
  expect(await screen.findByText(/Line total:.*27\.50/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
  expect(await screen.findByText('Pick a material.')).toBeTruthy()
  expect(
    screen.queryByText(
      'Pick an existing customer or switch to "+ New Customer".',
    ),
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Remove material' }))
  expect(screen.queryByLabelText('Material')).toBeNull()
})

it('saves material and gift-card sales together and includes materials in both invoice totals', async () => {
  const values = validInvoice()
  values.customers = []
  values.materials = [
    {
      key: 'material-sale',
      materialId: 'material-1',
      branchId: 'store-1',
      quantity: 2.5,
      unitPrice: 11,
    },
  ]
  values.giftCards = [
    {
      key: 'card-sale',
      code: '',
      amount: 50,
      boughtFor: 'Gift recipient',
      recipientPhone: '+97333112233',
      expiresOn: '',
    },
  ]
  values.discount = 10
  values.discountUnit = 'percent'
  values.payments = [
    { key: 'opening-payment', amount: 10, paymentType: 'cash' },
  ]
  const save = renderInvoice(values)
  save.mockResolvedValue({
    id: 'saved-invoice',
    totalPrice: 74.75,
    giftCards: [],
  })
  expect(
    screen.getByText('Subtotal (incl. VAT)').parentElement?.textContent,
  ).toContain('27.50')
  expect(
    screen.getByText('VAT (10%, incl.)').parentElement?.textContent,
  ).toContain('2.25')
  expect(screen.getByText('Total').parentElement?.textContent).toContain(
    '74.75',
  )
  expect(screen.getByText('Balance Due').parentElement?.textContent).toContain(
    '64.75',
  )
  expect(screen.getByLabelText('Invoice total').textContent).toContain('74.75')
  expect(screen.queryByLabelText('Code')).toBeNull()
  expect(
    screen.getByText(/A unique code is generated automatically/),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save invoice' }))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  const saved = save.mock.calls[0][0] as InvoiceFormValues
  expect(saved.customers).toEqual([])
  expect(saved.materials).toEqual(values.materials)
  expect(saved.giftCards).toEqual(values.giftCards)
  expect(saved.payments).toEqual(values.payments)
})
