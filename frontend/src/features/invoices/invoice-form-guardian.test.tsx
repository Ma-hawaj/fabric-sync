import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { selectOption } from '@/test/select-utils'
import { CustomerBlock } from './components/invoice-form/customer-block'
import { createEmptyCustomer } from './types/invoice-form'

// A minimal stand-in for InvoiceFormPage's customer list: real forms are
// built the same way, with `form.Field name="customers"` driving an array
// of CustomerBlocks. These tests cover the three child/guardian flows end
// to end, the way a user would actually drive them across one or more
// customer blocks on a single invoice.

const EXISTING_CUSTOMERS: Customer[] = [
  {
    id: 'cust-1',
    name: 'Ahmed Al-Mansoori',
    mobileNo: '+971-50-1234567',
    measurements: [],
  },
]

function InvoiceHarness() {
  const form = useForm({
    defaultValues: { customers: [createEmptyCustomer()] },
  })
  return (
    <form.Field name="customers">
      {(customersField) => (
        <div>
          {customersField.state.value.map((customer, index) => (
            <CustomerBlock
              key={customer.key}
              form={form as never}
              customerIndex={index}
              customerNumber={index + 1}
              existingCustomers={EXISTING_CUSTOMERS}
              removable={customersField.state.value.length > 1}
              onRemove={() => customersField.removeValue(index)}
            />
          ))}
          <button
            type="button"
            onClick={() => customersField.pushValue(createEmptyCustomer())}
          >
            Add Customer
          </button>
        </div>
      )}
    </form.Field>
  )
}

function switchToNewChild() {
  fireEvent.click(screen.getByText('+ New Customer'))
  fireEvent.click(screen.getByText('Child / Dependent'))
}

async function openGuardianPicker() {
  fireEvent.click(screen.getByText('Select guardian...'))
  return screen.findByText('+ New Guardian')
}

describe('invoice guardian flows', () => {
  it('only child order, with a brand-new child and a brand-new guardian', async () => {
    render(<InvoiceHarness />)

    switchToNewChild()
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Sultan Al-Mansoori' },
    })

    await openGuardianPicker()
    selectOption(await screen.findByRole('option', { name: '+ New Guardian' }))

    fireEvent.change(await screen.findByLabelText('Guardian Full Name'), {
      target: { value: 'Ahmed Al-Mansoori' },
    })
    fireEvent.change(screen.getByLabelText('Guardian Phone'), {
      target: { value: '+971-50-9998888' },
    })

    // Only one customer block exists — the guardian doesn't get an order.
    expect(screen.getByText('Customer 1')).toBeTruthy()
    expect(screen.queryByText('Customer 2')).toBeNull()
    expect(
      screen.getByText(
        'This guardian will be created as a customer, without an order, when the invoice is saved.',
      ),
    ).toBeTruthy()
  })

  it('only child order, linked to an already-existing guardian', async () => {
    render(<InvoiceHarness />)

    switchToNewChild()
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Sultan Al-Mansoori' },
    })

    fireEvent.click(screen.getByText('Select guardian...'))
    const option = await screen.findByRole('option', {
      name: 'Ahmed Al-Mansoori — +971-50-1234567',
    })
    selectOption(option)

    const trigger = screen.getByLabelText('Guardian')
    expect(trigger.textContent).toContain('Ahmed Al-Mansoori — +971-50-1234567')
    // No inline guardian fields — this guardian already exists.
    expect(screen.queryByLabelText('Guardian Full Name')).toBeNull()
    expect(screen.queryByText('Customer 2')).toBeNull()
  })

  it('child and guardian both getting an order on the same invoice', async () => {
    render(<InvoiceHarness />)

    // Customer 1: the guardian, a new adult with their own order.
    fireEvent.click(screen.getByText('+ New Customer'))
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Khalid Al-Otaibi' },
    })
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '+971-55-1112222' },
    })

    // Add customer 2: the child, linked to customer 1 as guardian.
    fireEvent.click(screen.getByText('Add Customer'))

    const secondBlockToggle = screen.getAllByText('+ New Customer')[1]
    fireEvent.click(secondBlockToggle)
    // Both blocks are in "new" mode now, so this toggle exists twice —
    // index 1 is customer 2's (customer 1 is the guardian, left as adult).
    fireEvent.click(screen.getAllByText('Child / Dependent')[1])
    const nameInputs = screen.getAllByLabelText('Full Name')
    fireEvent.change(nameInputs[nameInputs.length - 1], {
      target: { value: 'Sultan Al-Otaibi' },
    })

    fireEvent.click(screen.getByText('Select guardian...'))
    const option = await screen.findByRole('option', {
      name: /Khalid Al-Otaibi — \+971-55-1112222 \(Customer 1\)/,
    })
    selectOption(option)

    const trigger = screen.getByLabelText('Guardian')
    expect(trigger.textContent).toContain('Khalid Al-Otaibi — +971-55-1112222')
    expect(screen.getByText('Customer 1')).toBeTruthy()
    expect(screen.getByText('Customer 2')).toBeTruthy()
  })
})
