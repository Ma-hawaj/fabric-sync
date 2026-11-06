import type { Location } from './location'

export interface LocationFormValues {
  name: string
  receivesOrders: boolean
  holdsStock: boolean
  producesOrders: boolean
  isActive: boolean
}

// New locations receive orders and hold stock by default. Production must be
// enabled explicitly; stock availability alone never makes a workshop.
export function createEmptyLocationForm(): LocationFormValues {
  return {
    name: '',
    receivesOrders: true,
    holdsStock: true,
    producesOrders: false,
    isActive: true,
  }
}

export function locationToFormValues(location: Location): LocationFormValues {
  return {
    name: location.name,
    receivesOrders: location.receivesOrders,
    holdsStock: location.holdsStock,
    producesOrders: location.producesOrders,
    isActive: location.isActive,
  }
}
