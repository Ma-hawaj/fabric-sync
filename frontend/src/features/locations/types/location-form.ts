import type { Location } from './location'

export interface LocationFormValues {
  name: string
  receivesOrders: boolean
  holdsStock: boolean
  isActive: boolean
}

// New locations are fully capable and active by default — the common case is
// a branch that also keeps its own stock.
export function createEmptyLocationForm(): LocationFormValues {
  return {
    name: '',
    receivesOrders: true,
    holdsStock: true,
    isActive: true,
  }
}

export function locationToFormValues(location: Location): LocationFormValues {
  return {
    name: location.name,
    receivesOrders: location.receivesOrders,
    holdsStock: location.holdsStock,
    isActive: location.isActive,
  }
}
