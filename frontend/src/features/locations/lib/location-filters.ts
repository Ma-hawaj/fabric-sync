import type { Location } from '../types/location'

// The single place the capability rules live. GET /locations returns every
// location — including inactive ones, which the locations page needs — so each
// picker narrows the list to what it can actually use.

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
