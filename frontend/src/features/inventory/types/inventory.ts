// Shape of GET /materials — stock is tracked per location (branch).
export interface MaterialLocationStock {
  locationId: string
  location: string
  quantity: number
}

export interface Material {
  id: string
  name: string
  sku: string | null
  unit: string
  locations: MaterialLocationStock[]
}

// Shape of GET /locations — the branch table rows.
export interface Location {
  id: string
  name: string
}
