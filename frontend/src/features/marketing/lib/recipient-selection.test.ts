import { describe, expect, it } from 'vitest'
import {
  defaultRecipientSelection,
  optedInCustomers,
} from './recipient-selection'
import type { Customer } from '@/features/customers/types/customers'

function customer(overrides: Partial<Customer>): Customer {
  return {
    id: 'c1',
    name: 'Test Customer',
    mobileNo: '0500000000',
    marketingOptIn: false,
    measurements: [],
    ...overrides,
  }
}

describe('optedInCustomers', () => {
  it('keeps only customers who opted in', () => {
    const customers = [
      customer({ id: '1', marketingOptIn: true }),
      customer({ id: '2', marketingOptIn: false }),
      customer({ id: '3', marketingOptIn: true }),
    ]

    expect(optedInCustomers(customers).map((c) => c.id)).toEqual(['1', '3'])
  })

  it('returns an empty list when nobody opted in', () => {
    const customers = [customer({ id: '1', marketingOptIn: false })]
    expect(optedInCustomers(customers)).toEqual([])
  })
})

describe('defaultRecipientSelection', () => {
  it('pre-selects every customer passed in', () => {
    const customers = [customer({ id: '1' }), customer({ id: '2' })]

    expect(defaultRecipientSelection(customers)).toEqual({
      '1': true,
      '2': true,
    })
  })

  it('returns an empty selection for an empty list', () => {
    expect(defaultRecipientSelection([])).toEqual({})
  })
})
