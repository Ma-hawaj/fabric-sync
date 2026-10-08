import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { apiGetMock } from '@/lib/list-fixtures'
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
]

// The block fetches its customer's measurement history by id (the selection
// itself lives in the invoice summary), so the API mock answers both the
// by-id read and the pickers' list searches.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function Harness({ customer }: { customer: InvoiceCustomerDraft }) {
  const form = useForm({
    defaultValues: { customers: [customer] },
  })
  apiGet.mockImplementation(async (url: string) => {
    const { pathname } = new URL(url, 'http://localhost')
    if (pathname.startsWith('/customers/')) {
      const id = pathname.split('/').pop()
      return {
        data: EXISTING_CUSTOMERS.find((row) => row.id === id) ?? null,
      }
    }
    return apiGetMock({ '/customers': EXISTING_CUSTOMERS })(url)
  })
  const client = new QueryClient()
  return (
    <QueryClientProvider client={client}>
      <CustomerBlock
        form={form as never}
        customerIndex={0}
        customerNumber={1}
        removable={false}
        onRemove={() => {}}
      />
    </QueryClientProvider>
  )
}

describe('CustomerBlock', () => {
  it('renders orders and measurements without its own customer search', () => {
    render(<Harness customer={createEmptyCustomer()} />)

    // The customer is picked once in the invoice summary — no per-block
    // picker here.
    expect(
      screen.queryByPlaceholderText('Search customer by name or phone...'),
    ).toBeNull()
    expect(screen.getByText('Order 1')).toBeTruthy()
    expect(screen.getByText('Measurements')).toBeTruthy()
  })

  it('loads the picked customer measurement history by id', async () => {
    render(
      <Harness
        customer={{
          ...createEmptyCustomer(),
          existingCustomerId: 'cust-1',
        }}
      />,
    )

    // History arrives off the by-id read and seeds the snapshot dropdown.
    expect(await screen.findByText('Start Measurements From')).toBeTruthy()
    expect(apiGet).toHaveBeenCalledWith('/customers/cust-1')
  })
})
