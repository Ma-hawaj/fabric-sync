// Shape of GET /products — a finished good sold as-is, as opposed to a
// material, which is raw fabric consumed by a tailoring order. Stock is tracked
// per location the same way material stock is.
export interface ProductLocationStock {
  locationId: string
  location: string
  quantity: number
}

export interface Product {
  id: string
  name: string
  sku: string | null
  // Unlike a material, a product sells at a list price — the invoice form
  // prefills a line from it rather than making staff type one in.
  unitPrice: number
  isActive: boolean
  locations: ProductLocationStock[]
}

export function productTotalStock(product: Product): number {
  return product.locations.reduce((sum, l) => sum + l.quantity, 0)
}

export function productStockAt(product: Product, locationId: string): number {
  return (
    product.locations.find((l) => l.locationId === locationId)?.quantity ?? 0
  )
}

export function productOptionLabel(product: Product): string {
  return product.sku ? `${product.name} (${product.sku})` : product.name
}
