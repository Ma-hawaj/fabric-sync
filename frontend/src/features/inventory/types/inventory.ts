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
  // Fabric family shared by a fabric's colour variants ("Zabrjad 1" and
  // "Zabrjad 2" are both family "Zabrjad"); null on pre-existing rows.
  family: string | null
  locations: MaterialLocationStock[]
}
