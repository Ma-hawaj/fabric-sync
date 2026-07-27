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
          discountUnit: 'amount',
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
          discountUnit: 'percent',
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

  it('multiplies a product line out and taxes it with the orders', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          products: [productLine(3, 20)],
        })}
      />,
    )

    // 90 + (3 × 20) = 150, vat = 22.50, total = 172.50
    expect(rowValue('Subtotal')).toBe('SAR 150.00')
    expect(rowValue('VAT (15%)')).toBe('SAR 22.50')
    expect(rowValue('Total')).toBe('SAR 172.50')
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
    expect(rowValue('Subtotal')).toBe('SAR 100.00')
    expect(rowValue('VAT (15%)')).toBe('SAR 15.00')
    expect(rowValue('Total')).toBe('SAR 315.00')
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

    // 10% comes off the 100 of goods only: 90 × 1.15 = 103.50, plus 200
    expect(rowValue('VAT (15%)')).toBe('SAR 13.50')
    expect(rowValue('Total')).toBe('SAR 303.50')
  })

  it('nets a redemption off the balance due without changing the total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 103.50
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 50 },
          ],
          amountPaid: 20,
        })}
      />,
    )

    expect(rowValue('Total')).toBe('SAR 103.50')
    expect(rowValue('Gift Card Redeemed')).toBe('−SAR 50.00')
    // 103.50 - 50 - 20 = 33.50
    expect(rowValue('Balance Due')).toBe('SAR 33.50')
  })

  it('never redeems more than the invoice total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 103.50
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 500 },
          ],
        })}
      />,
    )

    expect(rowValue('Gift Card Redeemed')).toBe('−SAR 103.50')
    expect(rowValue('Balance Due')).toBe('SAR 0.00')
  })
})
