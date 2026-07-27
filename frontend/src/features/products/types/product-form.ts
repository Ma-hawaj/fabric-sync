import type { Product } from './product'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface ProductStockEntryDraft {
  key: string
  locationId: string
  quantity: NumberInput
}

export interface ProductFormValues {
  name: string
  sku: string
  unitPrice: NumberInput
  isActive: boolean
  // Always additive: on create these are the opening quantities, on edit they
  // are added to whatever is already on the shelf.
  entries: ProductStockEntryDraft[]
}

export function createEmptyProductStockEntry(): ProductStockEntryDraft {
  return {
    key: crypto.randomUUID(),
    locationId: '',
    quantity: '',
  }
}

// Stock starts empty rather than with one blank row: a product can be
// catalogued before any of it arrives.
export function createEmptyProductForm(): ProductFormValues {
  return {
    name: '',
    sku: '',
    unitPrice: '',
    isActive: true,
    entries: [],
  }
}

export function productToFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    sku: product.sku ?? '',
    unitPrice: product.unitPrice,
    isActive: product.isActive,
    entries: [],
  }
}
