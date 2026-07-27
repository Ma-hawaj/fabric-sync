import type { ProductStockEntryDraft } from '../types/product-form'

// Rows left completely blank are dropped rather than sent as zeroes — stock is
// optional on both the create and edit forms.
export function stockEntriesPayload(entries: ProductStockEntryDraft[]) {
  return entries
    .filter((entry) => entry.locationId && entry.quantity !== '')
    .map((entry) => ({
      locationId: entry.locationId,
      quantity: entry.quantity === '' ? 0 : entry.quantity,
    }))
}
