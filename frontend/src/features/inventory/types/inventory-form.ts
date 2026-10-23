import type { ReactFormExtendedApi } from '@tanstack/react-form'

export type StockEntryMode = 'existing' | 'new'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface StockEntryDraft {
  key: string
  locationId: string
  quantity: NumberInput
}

export interface InventoryFormValues {
  mode: StockEntryMode

  // mode: 'existing'
  materialId: string

  // mode: 'new'
  name: string
  sku: string
  unit: string
  // Fabric family grouping this material's colour variants; blank means
  // ungrouped, matching the backend's NULL.
  family: string

  juniorPrice: NumberInput
  normalPrice: NumberInput
  largePrice: NumberInput
  entries: StockEntryDraft[]
}

// The validator generic slots are left as `any` — this form has no
// per-field validators, only a schema-level one, so pinning them down
// would just be 11 extra type params for no benefit.
export type InventoryFormApi = ReactFormExtendedApi<
  InventoryFormValues,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>

export function createEmptyStockEntry(): StockEntryDraft {
  return {
    key: crypto.randomUUID(),
    locationId: '',
    quantity: '',
  }
}

export function createEmptyInventoryForm(): InventoryFormValues {
  return {
    mode: 'existing',
    materialId: '',
    name: '',
    sku: '',
    unit: 'meters',
    family: '',
    juniorPrice: '',
    normalPrice: '',
    largePrice: '',
    entries: [createEmptyStockEntry()],
  }
}
