import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { createEmptyMeasurement } from '@/features/customers/types/measurement-form'
import { apiGetMock } from '@/lib/list-fixtures'
import { typeSearchText } from '@/lib/test-events'
import { CustomerBlock } from './customer-block'
import { createEmptyCustomer } from '../../types/invoice-form'
import type { InvoiceCustomerDraft } from '../../types/invoice-form'

const EXISTING_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    name: 'Ahmed Al-Mansoori',
    mobileNo: '+971-50-1234567',
    measurements: [
      {
        id: 'meas-current',
        customerId: 'cust-1',
        date: new Date('2026-07-01'),
        chest: 108,
      },
      {
        id: 'meas-previous',
        customerId: 'cust-1',
        date: new Date('2025-06-15'),
        chest: 104,
      },
    ],
    invoices: [],
  },
  {
    id: 'cust-2',
    name: 'Fatima Al-Farsi',
    mobileNo: '+971-55-9876543',
    measurements: [],
    invoices: [],
  },
]

// The customer picker queries the server per keystroke, so the API layer is
// mocked to serve the search against in-memory rows instead of hitting the
// network in jsdom.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function Harness({ customer }: { customer: InvoiceCustomerDraft }) {
  const form = useForm({
    defaultValues: { customers: [customer] },
  })
  apiGet.mockImplementation(apiGetMock({ '/customers': EXISTING_CUSTOMERS }))
  const client = new QueryClient()
  return (
    <QueryClientProvider client={client}>
      <CustomerBlock
        form={form as never}
        customerIndex={0}
        customerNumber={1}
        onCustomerPicked={() => {}}
        removable={false}
        onRemove={() => {}}
      />
      <form.Subscribe selector={(state) => state.values.customers[0]}>
        {(draft) => (
          <output data-testid="customer-draft">{JSON.stringify(draft)}</output>
        )}
      </form.Subscribe>
    </QueryClientProvider>
  )
}

function searchInput() {
  return screen.getByPlaceholderText<HTMLInputElement>(
    'Search customer by name or phone...',
  )
}

// Base UI's Combobox only opens its popup for a click preceded by real
// pointer/mouse events; fireEvent.click alone looks synthetic and is ignored.
function openCustomerSearch() {
  const input = searchInput()
  fireEvent.pointerDown(input)
  fireEvent.mouseDown(input)
  fireEvent.click(input)
}

async function pickCustomer(name: RegExp | string) {
  openCustomerSearch()
  const option = await screen.findByRole('option', { name })
  fireEvent.click(option)
}

describe('CustomerBlock', () => {
  it('shows name and phone fields for a new customer', () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('+ New Customer'))
    expect(screen.getByLabelText('Full Name')).toBeTruthy()
    expect(screen.getByLabelText('Phone')).toBeTruthy()
    expect(
      screen.getByText(
        'This customer will be created when the invoice is saved.',
      ),
    ).toBeTruthy()
  })

  it('filters the customer list by the typed search text', async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    openCustomerSearch()
    typeSearchText(searchInput(), 'Fatima')

    expect(
      await screen.findByRole('option', {
        name: 'Fatima Al-Farsi — +971-55-9876543',
      }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.queryByRole('option', {
          name: 'Ahmed Al-Mansoori — +971-50-1234567',
        }),
      ).toBeNull(),
    )
  })

  it("loads the selected existing customer's current measurement snapshot", async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    await pickCustomer('Ahmed Al-Mansoori — +971-50-1234567')

    const chestInput = await screen.findByLabelText<HTMLInputElement>('Chest')
    expect(chestInput.value).toBe('108')
  })

  it('loads a blank measurement snapshot for a customer with no history', async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    await pickCustomer('Fatima Al-Farsi — +971-55-9876543')

    const chestInput = await screen.findByLabelText<HTMLInputElement>('Chest')
    expect(chestInput.value).toBe('')
  })

  it('clears the previous customer and measurement when switching to a new customer', async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    await pickCustomer('Ahmed Al-Mansoori — +971-50-1234567')
    expect(screen.getByLabelText<HTMLInputElement>('Chest').value).toBe('108')
    expect(
      JSON.parse(screen.getByTestId('customer-draft').textContent).measurement
        .loadedFromId,
    ).toBe('meas-current')

    fireEvent.click(screen.getByText('+ New Customer'))

    const draft = JSON.parse(
      screen.getByTestId('customer-draft').textContent,
    ) as InvoiceCustomerDraft
    expect(draft.mode).toBe('new')
    expect(draft.existingCustomerId).toBe('')
    expect(draft.measurement).toEqual(createEmptyMeasurement())
    expect(screen.getByLabelText<HTMLInputElement>('Chest').value).toBe('')
    expect(screen.queryByLabelText('Start Measurements From')).toBeNull()

    fireEvent.change(screen.getByLabelText('Chest'), {
      target: { value: '100' },
    })
    fireEvent.click(screen.getByText('+ New Customer'))
    expect(screen.getByLabelText<HTMLInputElement>('Chest').value).toBe('100')

    fireEvent.click(screen.getByText('Existing Customer'))
    expect(searchInput().value).toBe('')
    expect(screen.queryByText('Ahmed Al-Mansoori')).toBeNull()
  })
})
