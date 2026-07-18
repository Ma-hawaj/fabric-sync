import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { selectOption } from '@/test/select-utils'
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
    name: 'Sultan Al-Mansoori',
    guardianId: 'cust-1',
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
      removable={false}
      onRemove={() => {}}
    />
  )
}

describe('CustomerBlock', () => {
  it('shows a guardian picker instead of a phone field for a new child customer', () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('+ New Customer'))
    expect(screen.getByLabelText('Phone')).toBeTruthy()

    fireEvent.click(screen.getByText('Child / Dependent'))
    expect(screen.queryByLabelText('Phone')).toBeNull()
    expect(screen.getByText('Guardian')).toBeTruthy()
    expect(
      screen.getByText(
        'This child will be created and linked to the selected guardian when the invoice is saved.',
      ),
    ).toBeTruthy()
  })

  it('shows the adult note and phone field again when switched back from child', () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('+ New Customer'))
    fireEvent.click(screen.getByText('Child / Dependent'))
    fireEvent.click(screen.getByText('Adult'))

    expect(screen.getByLabelText('Phone')).toBeTruthy()
    expect(
      screen.getByText(
        'This customer will be created when the invoice is saved.',
      ),
    ).toBeTruthy()
  })

  it("loads the selected existing customer's current measurement snapshot", async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('Select customer...'))
    const option = await screen.findByRole('option', {
      name: 'Ahmed Al-Mansoori — +971-50-1234567',
    })
    selectOption(option)

    const chestInput = await screen.findByLabelText<HTMLInputElement>('Chest')
    expect(chestInput.value).toBe('108')
  })

  it('loads a blank measurement snapshot for a child with no history', async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('Select customer...'))
    const option = await screen.findByRole('option', {
      name: 'Sultan Al-Mansoori (child — Ahmed Al-Mansoori)',
    })
    selectOption(option)

    const chestInput = await screen.findByLabelText<HTMLInputElement>('Chest')
    expect(chestInput.value).toBe('')
  })

  it('lists a child customer alongside their guardian in the existing-customer picker', async () => {
    render(<Harness customer={createEmptyCustomer()} />)

    fireEvent.click(screen.getByText('Select customer...'))
    expect(
      await screen.findByRole('option', {
        name: 'Sultan Al-Mansoori (child — Ahmed Al-Mansoori)',
      }),
    ).toBeTruthy()
  })
})
