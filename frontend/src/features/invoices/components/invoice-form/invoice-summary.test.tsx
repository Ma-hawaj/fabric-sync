import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import { InvoiceSummary } from './invoice-summary'
import {
  createEmptyCustomer,
  createEmptyGiftCardLine,
  createEmptyInvoiceForm,
  createEmptyOrder,
  createEmptyProductLine,
  createEmptyRedemption,
} from '../../types/invoice-form'
import type { InvoiceFormValues } from '../../types/invoice-form'
import { CURRENCY } from '@/lib/currency'

const EXISTING_CUSTOMERS: Customer[] = []
const PRODUCT_NAMES = { 'prod-1': 'Silk Scarf' }

function Harness({ defaultValues }: { defaultValues: InvoiceFormValues }) {
  const form = useForm({ defaultValues })
  return (
    <InvoiceSummary
      form={form as never}
      existingCustomers={EXISTING_CUSTOMERS}
      branches={[]}
      productNames={PRODUCT_NAMES}
    />
  )
}

function baseValues(
  overrides: Partial<InvoiceFormValues> = {},
): InvoiceFormValues {
  return {
    ...createEmptyInvoiceForm(),
    date: '2026-07-18',
    customers: [],
    ...overrides,
  }
}

// A product line: `quantity` is a real multiplier here, unlike an order's
// materialAmount.
function productLine(quantity: number, unitPrice: number) {
  return {
    ...createEmptyProductLine(),
    productId: 'prod-1',
    quantity,
    unitPrice,
  }
}

// A customer with a single order line at the given price.
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

  it('multiplies a product line out and taxes it with the orders', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          products: [productLine(3, 20)],
        })}
      />,
    )

    // 90 + (3 × 20) = 150, vat = 15, total = 165
    expect(rowValue('Subtotal')).toBe(`${CURRENCY} 150.00`)
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 15.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 165.00`)
  })

  it('adds a gift card sale to the total without taxing it', () => {
    render(
      <Harness
        defaultValues={baseValues({
          products: [productLine(1, 100)],
          giftCards: [
            { ...createEmptyGiftCardLine(), code: 'GC-1', amount: 200 },
          ],
        })}
      />,
    )

    // The card's 200 is outside the VAT base entirely.
    expect(rowValue('Subtotal')).toBe(`${CURRENCY} 100.00`)
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 10.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 310.00`)
  })

  it('keeps a percentage discount off gift card sales', () => {
    render(
      <Harness
        defaultValues={baseValues({
          products: [productLine(1, 100)],
          giftCards: [
            { ...createEmptyGiftCardLine(), code: 'GC-1', amount: 200 },
          ],
          discount: 10,
          discountUnit: 'percent',
        })}
      />,
    )

    // 10% comes off the 100 of goods only: 90 × 1.10 = 99, plus 200
    expect(rowValue('VAT (10%)')).toBe(`${CURRENCY} 9.00`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 299.00`)
  })

  it('nets a redemption off the balance due without changing the total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 99.00
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 50 },
          ],
          amountPaid: 20,
        })}
      />,
    )

    expect(rowValue('Total')).toBe(`${CURRENCY} 99.00`)
    expect(rowValue('Gift Card Redeemed')).toBe(`−${CURRENCY} 50.00`)
    // 99 - 50 - 20 = 29
    expect(rowValue('Balance Due')).toBe(`${CURRENCY} 29.00`)
  })

  it('never redeems more than the invoice total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 99.00
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 500 },
          ],
        })}
      />,
    )

    expect(rowValue('Gift Card Redeemed')).toBe(`−${CURRENCY} 99.00`)
    expect(rowValue('Balance Due')).toBe(`${CURRENCY} 0.00`)
  })
})
