// Shape of GET /materials — stock is tracked per location (branch).
export interface MaterialLocationStock {
  locationId: string
  location: string
  quantity: number
  isActive?: boolean
  holdsStock?: boolean
}

export interface Material {
  id: string
  name: string
  sku: string | null
  unit: string
  // Fabric family shared by a fabric's colour variants; null on
  // pre-existing rows. Mirrors the inventory type above.
  family: string | null
  juniorPrice: number | null
  normalPrice: number | null
  largePrice: number | null
  locations: MaterialLocationStock[]
}

export function materialTotalStock(material: Material): number {
  return material.locations.reduce((sum, stock) => sum + stock.quantity, 0)
}

/** Saved edit seeds may omit flags; catalog rows carry current eligibility. */
export function materialStockAvailable(stock: MaterialLocationStock): boolean {
  return (
    stock.quantity > 0 && stock.isActive !== false && stock.holdsStock !== false
  )
}
