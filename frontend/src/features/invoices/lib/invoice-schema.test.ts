import { describe, expect, it } from 'vitest'
import { invoiceFormSchema } from './invoice-schema'
import { createEmptyCustomer, createEmptyOrder } from '../types/invoice-form'
import type {
  InvoiceCustomerDraft,
  InvoiceFormValues,
} from '../types/invoice-form'

function validOrder() {
  return { ...createEmptyOrder(), materialId: 'mat-1', materialAmount: 2 }
}

function baseValues(customers: InvoiceCustomerDraft[]): InvoiceFormValues {
  return {
    date: '2026-07-18',
    receivingBranch: '',
    discount: '',
    discountUnit: 'SAR',
    paymentStatus: 'unpaid',
    amountPaid: '',
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

  it('rejects a new adult customer with no name', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'adult' as const,
      name: '',
      mobileNo: '+966501234567',
      orders: [validOrder()],
    }
    expect(firstError([customer])?.message).toMatch(/enter a full name/i)
  })

  it('rejects a new adult customer with no phone number', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'adult' as const,
      name: 'Ahmed',
      mobileNo: '  ',
      orders: [validOrder()],
    }
    expect(firstError([customer])?.message).toMatch(/enter a phone number/i)
  })

  it('accepts a new child customer with an existing guardian, no phone required', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      mobileNo: '',
      guardian: {
        mode: 'existing' as const,
        existingCustomerId: 'cust-1',
        invoiceCustomerKey: '',
        name: '',
        nameArabic: '',
        mobileNo: '',
      },
      orders: [validOrder()],
    }
    expect(invoiceFormSchema.safeParse(baseValues([customer])).success).toBe(
      true,
    )
  })

  it('rejects a new child customer with no guardian selected', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      orders: [validOrder()],
    }
    const error = firstError([customer])
    expect(error?.message).toMatch(/select a guardian/i)
    expect(error?.path).toEqual(['customers', 0, 'guardian'])
  })

  it('accepts a new child customer with a newly-entered guardian', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      guardian: {
        mode: 'new' as const,
        existingCustomerId: '',
        invoiceCustomerKey: '',
        name: 'Ahmed Al-Mansoori',
        nameArabic: '',
        mobileNo: '+966501234567',
      },
      orders: [validOrder()],
    }
    expect(invoiceFormSchema.safeParse(baseValues([customer])).success).toBe(
      true,
    )
  })

  it('rejects a newly-entered guardian with no phone number', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      guardian: {
        mode: 'new' as const,
        existingCustomerId: '',
        invoiceCustomerKey: '',
        name: 'Ahmed Al-Mansoori',
        nameArabic: '',
        mobileNo: '',
      },
      orders: [validOrder()],
    }
    const error = firstError([customer])
    expect(error?.message).toMatch(/phone number/i)
    expect(error?.path).toEqual(['customers', 0, 'guardian', 'mobileNo'])
  })

  it('accepts a child guardian that points at another customer on the same invoice', () => {
    const guardianAdult = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'adult' as const,
      name: 'Ahmed Al-Mansoori',
      mobileNo: '+966501234567',
      orders: [validOrder()],
    }
    const child = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      guardian: {
        mode: 'invoiceCustomer' as const,
        existingCustomerId: '',
        invoiceCustomerKey: guardianAdult.key,
        name: '',
        nameArabic: '',
        mobileNo: '',
      },
      orders: [validOrder()],
    }
    expect(
      invoiceFormSchema.safeParse(baseValues([guardianAdult, child])).success,
    ).toBe(true)
  })

  it('rejects a child guardian pointing at a customer no longer on the invoice', () => {
    const child = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      guardian: {
        mode: 'invoiceCustomer' as const,
        existingCustomerId: '',
        invoiceCustomerKey: 'some-removed-key',
        name: '',
        nameArabic: '',
        mobileNo: '',
      },
      orders: [validOrder()],
    }
    expect(firstError([child])?.message).toMatch(/removed from this invoice/i)
  })

  it('rejects an order with no material picked', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [{ ...createEmptyOrder(), materialAmount: 2 }],
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
      orders: [{ ...createEmptyOrder(), materialId: 'mat-1' }],
    }
    expect(firstError([customer])?.message).toMatch(
      /pick a material and quantity/i,
    )
  })

  it('rejects an invoice with no customers', () => {
    expect(firstError([])?.message).toMatch(/at least one customer/i)
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
