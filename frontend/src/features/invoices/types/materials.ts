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

export function materialTotalStock(material: Material): number {
  return material.locations.reduce((sum, stock) => sum + stock.quantity, 0)
}
