import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
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
        cuffling: 'Double Cuff',
      },
      {
        id: 'meas-previous',
        customerId: 'cust-1',
        date: new Date('2025-06-15'),
        chest: 104,
        cuffling: 'Single Cuff',
      },
    ],
  },
  {
    id: 'cust-2',
    name: 'Fatima Al-Farsi',
    mobileNo: '+971-55-9876543',
    measurements: [],
  },
]

function Harness({ customer }: { customer: InvoiceCustomerDraft }) {
  const form = useForm({
    defaultValues: { customers: [customer] },
  })
  return (
    <CustomerBlock
      form={form as never}
      customerIndex={0}
      customerNumber={1}
      existingCustomers={EXISTING_CUSTOMERS}
      materials={[]}
      removable={false}
      onRemove={() => {}}
    />
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
    fireEvent.change(searchInput(), { target: { value: 'Fatima' } })

    expect(
      await screen.findByRole('option', {
        name: 'Fatima Al-Farsi — +971-55-9876543',
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('option', {
        name: 'Ahmed Al-Mansoori — +971-50-1234567',
      }),
    ).toBeNull()
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
})
