// Shape of GET /locations — the branch table rows. Shared by any feature
// that needs to pick a physical location: inventory stock entries, the
// invoice form's receiving branch, etc.
//
// Pickup, stock, and production are independent capabilities. Use the helpers
// in ../lib/location-filters rather than reading flags in individual pickers.
export interface Location {
  id: string
  name: string
  receivesOrders: boolean
  holdsStock: boolean
  producesOrders: boolean
  isActive: boolean
}
