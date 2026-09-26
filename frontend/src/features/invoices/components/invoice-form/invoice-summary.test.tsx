import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import type { Customer } from '@/features/customers/types/customers'
import type { Product } from '@/features/products/types/product'
import { apiGetMock } from '@/lib/list-fixtures'
import { InvoiceSummary } from './invoice-summary'
import {
  createEmptyCustomer,
  createEmptyGiftCardLine,
  createEmptyInvoiceForm,
  createEmptyOrder,
  createEmptyPayment,
  createEmptyProductLine,
  createEmptyRedemption,
} from '../../types/invoice-form'
import type { InvoiceFormValues } from '../../types/invoice-form'
import { CURRENCY } from '@/lib/currency'

const PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Silk Scarf',
    sku: 'FB-SLK-01',
    unitPrice: 50,
    isActive: true,
    locations: [],
  },
]

// The summary's receiving-branch and optional-customer pickers query the
// server, so the API layer is mocked to serve in-memory rows instead of
// hitting the network in jsdom. These tests read the summary rows, not the
// picker options, so empty/simple fixtures are enough.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@/lib/api', () => ({
  apiClient: { get: apiGet },
  ApiError: class ApiError extends Error {},
}))

function Harness({ defaultValues }: { defaultValues: InvoiceFormValues }) {
  const form = useForm({ defaultValues })
  apiGet.mockImplementation(
    apiGetMock({
      '/customers': [],
      '/locations': [],
    }),
  )
  const customerNames = { current: new Map<string, Customer>() }
  const productNames = {
    current: new Map(PRODUCTS.map((product) => [product.id, product])),
  }
  const client = new QueryClient()
  return (
    <QueryClientProvider client={client}>
      <InvoiceSummary
        form={form as never}
        customerNames={customerNames}
        productNames={productNames}
      />
    </QueryClientProvider>
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

// An up-front payment row at the given amount.
function payment(amount: number) {
  return { ...createEmptyPayment(), amount, paymentType: 'cash' as const }
}

// Finds the amount next to a labeled row (e.g. "Subtotal", "Total") rather
// than matching the amount text directly, since a single-order invoice's
// line item and subtotal can render the same amount.
function rowValue(label: string) {
  return screen.getByText(label).closest('div')!.textContent.replace(label, '')
}

// Line prices are gross (VAT included): a 90 order holds 81.82 of net and
// 8.18 of VAT, and the total is the 90 quoted — never 90 plus tax.
describe('InvoiceSummary', () => {
  it('extracts VAT from order line items instead of adding it', () => {
    render(
      <Harness
        defaultValues={baseValues({ customers: [customerWithOrder(90)] })}
      />,
    )

    expect(rowValue('Subtotal (incl. VAT)')).toBe(`${CURRENCY} 90.00`)
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 8.18`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 90.00`)
  })

  it('applies a flat CURRENCY discount to the gross before extracting VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: 'amount',
        })}
      />,
    )

    // gross = 90 - 10 = 80, net 72.73, vat 7.27, total 80
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 7.27`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 80.00`)
  })

  it('applies a percentage discount to the gross before extracting VAT', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          discount: 10,
          discountUnit: 'percent',
        })}
      />,
    )

    // gross = 90 - 9 = 81, net 73.64, vat 7.36, total 81
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 7.36`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 81.00`)
  })

  it('computes balance due as total minus payments, never negative', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 90.00
          payments: [payment(200)],
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

    // gross = 70, net 63.64, vat 6.36, total 70
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 6.36`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 70.00`)
  })

  it('multiplies a product line out and shares the gross subtotal', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)],
          products: [productLine(3, 20)],
        })}
      />,
    )

    // 90 + (3 × 20) = 150 gross, net 136.36, vat 13.64
    expect(rowValue('Subtotal (incl. VAT)')).toBe(`${CURRENCY} 150.00`)
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 13.64`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 150.00`)
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
    expect(rowValue('Subtotal (incl. VAT)')).toBe(`${CURRENCY} 100.00`)
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 9.09`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 300.00`)
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

    // 10% comes off the 100 of gross goods only: 90, plus 200
    expect(rowValue('VAT (10%, incl.)')).toBe(`${CURRENCY} 8.18`)
    expect(rowValue('Total')).toBe(`${CURRENCY} 290.00`)
  })

  it('nets tender off the balance due without changing the total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 90.00
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 50 },
          ],
          payments: [payment(20)],
        })}
      />,
    )

    expect(rowValue('Total')).toBe(`${CURRENCY} 90.00`)
    expect(rowValue('Gift Card Redeemed')).toBe(`−${CURRENCY} 50.00`)
    // 90 - 50 - 20 = 20
    expect(rowValue('Balance Due')).toBe(`${CURRENCY} 20.00`)
  })

  it('never redeems more than the invoice total', () => {
    render(
      <Harness
        defaultValues={baseValues({
          customers: [customerWithOrder(90)], // total 90.00
          redemptions: [
            { ...createEmptyRedemption(), code: 'GC-1', amount: 500 },
          ],
        })}
      />,
    )

    expect(rowValue('Gift Card Redeemed')).toBe(`−${CURRENCY} 90.00`)
    expect(rowValue('Balance Due')).toBe(`${CURRENCY} 0.00`)
  })
})
