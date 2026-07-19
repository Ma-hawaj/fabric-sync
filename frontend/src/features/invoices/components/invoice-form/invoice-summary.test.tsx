import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { InvoiceSummary } from './invoice-summary'
import { createEmptyCustomer, createEmptyOrder } from '../../types/invoice-form'
import type { InvoiceFormValues } from '../../types/invoice-form'

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
    discountUnit: 'SAR',
    paymentStatus: 'unpaid',
    amountPaid: '',
    customers: [],
    ...overrides,
  }
}

// A customer with a single order line priced at 90 SAR.
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

    expect(rowValue('Subtotal')).toBe('SAR 90.00')
    expect(rowValue('VAT (15%)')).toBe('SAR 13.50')
    expect(rowValue('Total')).toBe('SAR 103.50')
  })

  it('applies a flat SAR discount before computing VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: 'SAR',
        })}
      />,
    )

    // taxable = 90 - 10 = 80, vat = 12, total = 92
    expect(rowValue('VAT (15%)')).toBe('SAR 12.00')
    expect(rowValue('Total')).toBe('SAR 92.00')
  })

  it('applies a percentage discount before computing VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: '%',
        })}
      />,
    )

    // taxable = 90 - 9 = 81, vat = 12.15, total = 93.15
    expect(rowValue('VAT (15%)')).toBe('SAR 12.15')
    expect(rowValue('Total')).toBe('SAR 93.15')
  })

  it('computes balance due as total minus amount paid, never negative', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 103.50
          amountPaid: 200,
        })}
      />,
    )

    expect(rowValue('Balance Due')).toBe('SAR 0.00')
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

    // taxable = 70, vat = 10.5, total = 80.5
    expect(rowValue('VAT (15%)')).toBe('SAR 10.50')
    expect(rowValue('Total')).toBe('SAR 80.50')
  })
})
