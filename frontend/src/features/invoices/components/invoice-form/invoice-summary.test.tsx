import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { InvoiceSummary } from './invoice-summary'
import { createEmptyCustomer, createEmptyOrder } from '../../types/invoice-form'
import type { InvoiceFormValues } from '../../types/invoice-form'
import { CURRENCY } from '@/lib/currency'

const EXISTING_CUSTOMERS: Customer[] = []

function Harness({ defaultValues }: { defaultValues: InvoiceFormValues }) {
  const form = useForm({ defaultValues })
  return (
    <InvoiceSummary
      form={form as never}
      existingCustomers={EXISTING_CUSTOMERS}
      branches={[]}
    />
  )
}

function baseValues(
  overrides: Partial<InvoiceFormValues> = {},
): InvoiceFormValues {
  return {
    date: '2026-07-18',
    receivingBranch: '',
    discount: '',
    discountUnit: 'amount',
    paymentStatus: 'unpaid',
    amountPaid: '',
    customers: [],
    ...overrides,
  }
}

// A customer with a single order line priced at 90 CURRECY.
function customerWithOrder(price: number) {
  return {
    ...createEmptyCustomer(),
    orders: [
      { ...createEmptyOrder(), materialId: 'mat-1', materialAmount: 5, price },
    ],
  }
}

// Finds the amount next to a labeled row (e.g. "Subtotal", "Total") rather
// than matching the amount text directly, since a single-order invoice's
// line item and subtotal can render the same amount.
function rowValue(label: string) {
  return screen.getByText(label).closest('div')!.textContent.replace(label, '')
}

describe('InvoiceSummary', () => {
  it('computes subtotal, VAT, and total from order line items', () => {
    render(
      <Harness
        defaultValues={baseValues({ customers: [customerWithOrder(90)] })}
      />,
    )

    expect(rowValue('Subtotal')).toBe(`${CURRENCY} 90.00`)
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 9.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 99.00`)
  })

  it('applies a flat CURRENCY discount before computing VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: 'amount',
        })}
      />,
    )

    // taxable = 90 - 10 = 80, vat = 8, total = 88
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 8.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 88.00`)
  })

  it('applies a percentage discount before computing VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: 'percent',
        })}
      />,
    )

    // taxable = 90 - 9 = 81, vat = 8.10, total = 89.10
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 8.10`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 89.10`)
  })

  it('computes balance due as total minus amount paid, never negative', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 99.00
          amountPaid: 200,
        })}
      />,
    )

    expect(rowValue('Balance Due')).toBe(`${CURRENCY} 0.00`)
  })

  it('updates the discount amount live as the input changes', () => {
    render(
      <Harness
        defaultValues={baseValues({ customers: [customerWithOrder(90)] })}
      />,
    )

    fireEvent.change(screen.getByLabelText('Discount'), {
      target: { value: '20' },
    })

    // taxable = 70, vat = 7, total = 77
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 7.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 77.00`)
  })
})
