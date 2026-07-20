// Shape of GET /locations — the branch table rows. Shared by any feature
// that needs to pick a physical location: inventory stock entries, the
// invoice form's receiving branch, etc.
export interface Location {
  id: string
  name: string
}
