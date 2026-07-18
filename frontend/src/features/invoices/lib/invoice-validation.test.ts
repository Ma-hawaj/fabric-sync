import { describe, expect, it } from 'vitest'
import { validateCustomers } from './invoice-validation'
import { createEmptyCustomer, createEmptyOrder } from '../types/invoice-form'

function validOrder() {
  return { ...createEmptyOrder(), materialId: 'mat-1', materialAmount: 2 }
}

describe('validateCustomers', () => {
  it('passes for a fully filled existing customer with a valid order', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [validOrder()],
    }
    expect(validateCustomers([customer])).toBeNull()
  })

  it('rejects an existing customer with no selection', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: '',
      orders: [validOrder()],
    }
    expect(validateCustomers([customer])).toMatch(/pick an existing customer/)
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
    expect(validateCustomers([customer])).toMatch(/enter a full name/)
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
    expect(validateCustomers([customer])).toMatch(/enter a phone number/)
  })

  it('accepts a new child customer with a name and guardian, no phone required', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      mobileNo: '',
      guardianId: 'cust-1',
      orders: [validOrder()],
    }
    expect(validateCustomers([customer])).toBeNull()
  })

  it('rejects a new child customer with no guardian selected', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'new' as const,
      customerType: 'child' as const,
      name: 'Sultan',
      guardianId: '',
      orders: [validOrder()],
    }
    expect(validateCustomers([customer])).toMatch(/select a guardian/)
  })

  it('rejects an order with no material picked', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [{ ...createEmptyOrder(), materialAmount: 2 }],
    }
    expect(validateCustomers([customer])).toMatch(
      /pick a material and quantity/,
    )
  })

  it('rejects an order with no quantity entered', () => {
    const customer = {
      ...createEmptyCustomer(),
      mode: 'existing' as const,
      existingCustomerId: 'cust-1',
      orders: [{ ...createEmptyOrder(), materialId: 'mat-1' }],
    }
    expect(validateCustomers([customer])).toMatch(
      /pick a material and quantity/,
    )
  })

  it('reports the correct customer and order number in multi-customer invoices', () => {
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
    expect(validateCustomers([good, bad])).toMatch(/^Customer 2:/)
  })
})
