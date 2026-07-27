import { describe, expect, it } from 'vitest'
import { orderReceivingLocations, stockLocations } from './location-filters'
import type { Location } from '../types/location'

function location(overrides: Partial<Location>): Location {
  return {
    id: 'loc-1',
    name: 'Location',
    receivesOrders: true,
    holdsStock: true,
    isActive: true,
    ...overrides,
  }
}

const BRANCH_ONLY = location({
  id: 'branch',
  name: 'Downtown Branch',
  holdsStock: false,
})
const STORE_ONLY = location({
  id: 'store',
  name: 'Main Warehouse',
  receivesOrders: false,
})
const BOTH = location({ id: 'both', name: 'Head Office' })
const INACTIVE = location({ id: 'closed', name: 'Old Shop', isActive: false })

const ALL = [BRANCH_ONLY, STORE_ONLY, BOTH, INACTIVE]

describe('orderReceivingLocations', () => {
  it('keeps only active locations customers can collect orders from', () => {
    expect(orderReceivingLocations(ALL).map((l) => l.id)).toEqual([
      'branch',
      'both',
    ])
  })
})

describe('stockLocations', () => {
  it('keeps only active locations that hold material stock', () => {
    expect(stockLocations(ALL).map((l) => l.id)).toEqual(['store', 'both'])
  })
})

describe('both filters', () => {
  it('exclude deactivated locations even when the capability is set', () => {
    const deactivatedBranch = location({ id: 'x', isActive: false })
    expect(orderReceivingLocations([deactivatedBranch])).toEqual([])
    expect(stockLocations([deactivatedBranch])).toEqual([])
  })
})
