import type { ReactFormExtendedApi } from '@tanstack/react-form'

export type StockEntryMode = 'existing' | 'new'

// A blank string means "not entered yet" for a numeric field, distinct from 0.
export type NumberInput = number | ''

export interface InventoryFormValues {
  mode: StockEntryMode

  // mode: 'existing'
  materialId: string

  // mode: 'new'
  name: string
  sku: string
  unit: string

  location: string
  quantity: NumberInput
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

export function createEmptyInventoryForm(): InventoryFormValues {
  return {
    mode: 'existing',
    materialId: '',
    name: '',
    sku: '',
    unit: 'meters',
    location: '',
    quantity: '',
  }
}
