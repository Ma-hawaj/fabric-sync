import { describe, expect, it } from 'vitest'
import { invoiceFormSchema } from './invoice-schema'
import {
  createEmptyCustomer,
  createEmptyGiftCardLine,
  createEmptyInvoiceForm,
  createEmptyOrder,
  createEmptyProductLine,
  createEmptyRedemption,
} from '../types/invoice-form'
import type {
  InvoiceCustomerDraft,
  InvoiceFormValues,
} from '../types/invoice-form'

function validOrder() {
  return {
    ...createEmptyOrder(),
    materialId: 'mat-1',
    materialAmount: 2,
    price: 150,
  }
}

function validProductLine() {
  return { ...createEmptyProductLine(), productId: 'prod-1', unitPrice: 40 }
}

function values(overrides: Partial<InvoiceFormValues> = {}): InvoiceFormValues {
  return {
    ...createEmptyInvoiceForm(),
    date: '2026-07-18',
    customers: [],
    ...overrides,
  }
}

function firstErrorFor(input: InvoiceFormValues) {
  const result = invoiceFormSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

function baseValues(customers: InvoiceCustomerDraft[]): InvoiceFormValues {
  return values({ customers, productionBranch: 'loc-1' })
}

function firstError(customers: InvoiceCustomerDraft[]) {
  return firstErrorFor(baseValues(customers))
}

describe('invoiceFormSchema', () => {
  it('passes for a fully filled existing customer with a valid order', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    expect(invoiceFormSchema.safeParse(baseValues([customer])).success).toBe(
      true,
    )
  })

  it('rejects an existing customer with no selection', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: '',
      orders: [validOrder()],
    }
    const error = firstError([customer])
    expect(error?.message).toMatch(/pick an existing customer/i)
    expect(error?.path).toEqual(['customers', 0, 'existingCustomerId'])
  })

  it('rejects a new customer with no name', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      name: '',
      mobileNo: '+966501234567',
      orders: [validOrder()],
    }
    expect(firstError([customer])?.message).toMatch(/enter a full name/i)
  })

  it('rejects a new customer with no phone number', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      name: 'Ahmed',
      mobileNo: '  ',
      orders: [validOrder()],
    }
    expect(firstError([customer])?.message).toMatch(/enter a phone number/i)
  })

  it('accepts a fully filled new customer', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      name: 'Ahmed Al-Mansoori',
      mobileNo: '+966501234567',
      orders: [validOrder()],
    }
    expect(invoiceFormSchema.safeParse(baseValues([customer])).success).toBe(
      true,
    )
  })

  it('rejects an order with no material picked', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [{ ...createEmptyOrder(), materialAmount: 2, price: 150 }],
    }
    const error = firstError([customer])
    expect(error?.message).toMatch(/pick a material and quantity/i)
    expect(error?.path).toEqual(['customers', 0, 'orders', 0, 'materialId'])
  })

  it('rejects an order with no quantity entered', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [{ ...createEmptyOrder(), materialId: 'mat-1', price: 150 }],
    }
    expect(firstError([customer])?.message).toMatch(
      /pick a material and quantity/i,
    )
  })

  it('rejects an order with no price entered', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [
        { ...createEmptyOrder(), materialId: 'mat-1', materialAmount: 2 },
      ],
    }
    const error = firstError([customer])
    expect(error?.message).toMatch(/enter a price/i)
    expect(error?.path).toEqual(['customers', 0, 'orders', 0, 'price'])
  })

  it('rejects an invoice with no lines of any kind', () => {
    const error = firstError([])
    expect(error?.message).toMatch(/at least one order, product, or gift card/i)
    expect(error?.path).toEqual(['customers'])
  })

  it('accepts an invoice of only products, with no customer at all', () => {
    const input = values({
      products: [validProductLine()],
      productBranch: 'loc-1',
    })
    expect(firstErrorFor(input)).toBeNull()
  })

  it('accepts an invoice of only gift cards', () => {
    const input = values({
      giftCards: [{ ...createEmptyGiftCardLine(), code: 'GC-1', amount: 200 }],
    })
    expect(firstErrorFor(input)).toBeNull()
  })

  it('requires a sold-from location once there are product lines', () => {
    const input = values({ products: [validProductLine()], productBranch: '' })
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/location these products are sold from/i)
    expect(error?.path).toEqual(['productBranch'])
  })

  it('requires a made-at location once there are orders', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    const input = { ...baseValues([customer]), productionBranch: '' }
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/location these orders are made at/i)
    expect(error?.path).toEqual(['productionBranch'])
  })

  it('rejects a product line with no product picked', () => {
    const input = values({
      products: [{ ...validProductLine(), productId: '' }],
      productBranch: 'loc-1',
    })
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/pick a product/i)
    expect(error?.path).toEqual(['products', 0, 'productId'])
  })

  it('rejects a product line with no unit price', () => {
    const input = values({
      products: [{ ...validProductLine(), unitPrice: '' }],
      productBranch: 'loc-1',
    })
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/enter a unit price/i)
    expect(error?.path).toEqual(['products', 0, 'unitPrice'])
  })

  it('rejects a gift card sold with no amount', () => {
    const input = values({
      giftCards: [{ ...createEmptyGiftCardLine(), code: 'GC-1', amount: '' }],
    })
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/amount greater than 0/i)
    expect(error?.path).toEqual(['giftCards', 0, 'amount'])
  })

  it('rejects the same gift card applied twice, ignoring case and spacing', () => {
    const input = values({
      products: [validProductLine()],
      productBranch: 'loc-1',
      redemptions: [
        { ...createEmptyRedemption(), code: 'GC-1', amount: 20 },
        { ...createEmptyRedemption(), code: ' gc-1 ', amount: 10 },
      ],
    })
    const error = firstErrorFor(input)
    expect(error?.message).toMatch(/only be applied once/i)
    expect(error?.path).toEqual(['redemptions', 1, 'code'])
  })

  it('requires a payment type when an advance payment is entered', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    const withAdvance = { ...baseValues([customer]), amountPaid: 100 }
    const result = invoiceFormSchema.safeParse(withAdvance)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/payment was made/i)
      expect(result.error.issues[0]?.path).toEqual(['paymentType'])
    }
  })

  it('accepts an advance payment once a payment type is picked', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    const withPaymentType = {
      ...baseValues([customer]),
      amountPaid: 100,
      paymentType: 'cash' as const,
    }
    expect(invoiceFormSchema.safeParse(withPaymentType).success).toBe(true)
  })

  it('reports the correct customer path in multi-customer invoices', () => {
    const good = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    const bad = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: '',
      orders: [validOrder()],
    }
    const error = firstError([good, bad])
    expect(error?.path).toEqual(['customers', 1, 'existingCustomerId'])
  })
})
