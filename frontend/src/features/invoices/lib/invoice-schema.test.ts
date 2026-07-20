import { describe, expect, it } from 'vitest'
import { invoiceFormSchema } from './invoice-schema'
import { createEmptyCustomer, createEmptyOrder } from '../types/invoice-form'
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

function baseValues(customers: InvoiceCustomerDraft[]): InvoiceFormValues {
  return {
    date: '2026-07-18',
    receivingBranch: '',
    discount: '',
    discountUnit: 'amount',
    paymentStatus: 'unpaid',
    amountPaid: '',
    paymentType: '',
    customers,
  }
}

function firstError(customers: InvoiceCustomerDraft[]) {
  const result = invoiceFormSchema.safeParse(baseValues(customers))
  return result.success ? null : result.error.issues[0]
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

  it('rejects an invoice with no customers', () => {
    expect(firstError([])?.message).toMatch(/at least one customer/i)
  })

  it('requires a payment type when an advance payment is entered', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    const values = { ...baseValues([customer]), amountPaid: 100 }
    const result = invoiceFormSchema.safeParse(values)
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
    const values = {
      ...baseValues([customer]),
      amountPaid: 100,
      paymentType: 'cash' as const,
    }
    expect(invoiceFormSchema.safeParse(values).success).toBe(true)
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
