export interface MaterialLocationStock {
  location: string
  quantity: number
}

export interface Material {
  id: string
  name: string
  sku: string
  unit: string
  locations: MaterialLocationStock[]
}
