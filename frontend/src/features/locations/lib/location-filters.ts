import type { PickerFilter } from '@/lib/async-combobox'
import type { Location } from '../types/location'

/** Location changes affect lists, preferences, and independently cached pickers. */
export const LOCATION_QUERY_KEYS = [
  'locations',
  'default-location',
  'invoice-location-default',
  'invoice-issuing-branch',
  'invoice-receiving-branch',
  'invoice-sold-from',
  'invoice-production-branch',
  'production-location-picker',
  'stock-entry-locations',
  'return-restock-locations',
] as const

// The single place the capability rules live. GET /locations returns every
// location — including inactive ones, which the locations page needs — so each
// picker narrows the list to what it can actually use.
//
// Searchable pickers apply the same rules server-side: the `locations` ListSpec
// exposes `isActive`, `receivesOrders` and `holdsStock` as boolean filters, so
// the async comboboxes hand the backend these filter lists rather than pulling
// the whole branch table and filtering in memory.

const ACTIVE_FILTER: PickerFilter = {
  id: 'isActive',
  value: true,
  variant: 'boolean',
  operator: 'eq',
}

/** Any active branch can issue an invoice, independently of fulfilment. */
export const ISSUING_BRANCH_FILTERS: readonly PickerFilter[] = [ACTIVE_FILTER]

/** Locations a customer can collect a finished order from (server-side). */
export const ORDER_RECEIVING_FILTERS: readonly PickerFilter[] = [
  ACTIVE_FILTER,
  { id: 'receivesOrders', value: true, variant: 'boolean', operator: 'eq' },
]

/** Locations material stock can be held at (server-side). */
export const STOCK_FILTERS: readonly PickerFilter[] = [
  ACTIVE_FILTER,
  { id: 'holdsStock', value: true, variant: 'boolean', operator: 'eq' },
]

/** Locations explicitly enabled for production, independently of stock. */
export const PRODUCTION_FILTERS: readonly PickerFilter[] = [
  ACTIVE_FILTER,
  { id: 'producesOrders', value: true, variant: 'boolean', operator: 'eq' },
]

/** Any active location may issue invoices, independently of fulfilment. */
export function issuingLocations(locations: Location[]): Location[] {
  return locations.filter((location) => location.isActive)
}

/** Locations a customer can collect a finished order from. */
export function orderReceivingLocations(locations: Location[]): Location[] {
  return locations.filter(
    (location) => location.isActive && location.receivesOrders,
  )
}

/** Closing reports retain retired branches so their historical days remain accessible. */
export function closingBranches(locations: Location[]): Location[] {
  return locations
}

/** Locations material stock can be held at. */
export function stockLocations(locations: Location[]): Location[] {
  return locations.filter(
    (location) => location.isActive && location.holdsStock,
  )
}

/** Locations explicitly enabled for production, independently of stock. */
export function productionLocations(locations: Location[]): Location[] {
  return locations.filter(
    (location) => location.isActive && location.producesOrders,
  )
}
