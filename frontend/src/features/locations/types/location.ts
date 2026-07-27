// Shape of GET /locations — the branch table rows. Shared by any feature
// that needs to pick a physical location: inventory stock entries, the
// invoice form's receiving branch, etc.
//
// `receivesOrders` and `holdsStock` are independent, so a location can be a
// branch customers collect orders from, a store that only holds material
// stock, or both. Use the helpers in ../lib/location-filters rather than
// reading the flags directly at each picker.
export interface Location {
  id: string
  name: string
  receivesOrders: boolean
  holdsStock: boolean
  isActive: boolean
}
