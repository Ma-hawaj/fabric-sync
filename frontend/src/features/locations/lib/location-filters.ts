import type { PickerFilter } from '@/lib/async-combobox'
import type { Location } from '../types/location'

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

/**
 * Locations a garment can be made at. Production happens where the material is,
 * so this currently follows the stock rule — but it is named separately so that
 * if a dedicated production capability is ever added to `branch`, this is the
 * one place that changes rather than every picker.
 */
export const PRODUCTION_FILTERS: readonly PickerFilter[] = STOCK_FILTERS

/** Locations a customer can collect a finished order from. */
export function orderReceivingLocations(locations: Location[]): Location[] {
  return locations.filter(
    (location) => location.isActive && location.receivesOrders,
  )
}

/** Locations material stock can be held at. */
export function stockLocations(locations: Location[]): Location[] {
  return locations.filter(
    (location) => location.isActive && location.holdsStock,
  )
}

/**
 * Locations a garment can be made at. Production happens where the material is,
 * so this currently follows the stock rule — but it is named separately so that
 * if a dedicated production capability is ever added to `branch`, this is the
 * one place that changes rather than every picker.
 */
export function productionLocations(locations: Location[]): Location[] {
  return stockLocations(locations)
}
