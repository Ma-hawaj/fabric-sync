import { z } from 'zod'
import type { NumberInput } from '../types/inventory-form'
import type { Material } from '../types/inventory'

export interface RemoveStockEntryValues {
  locationId: string
  quantity: NumberInput
}

export interface RemoveStockFormValues {
  entries: RemoveStockEntryValues[]
}

// One row per location that holds stock, all blank — blank means "leave it",
// so removing is opt-in per location.
export function createRemoveStockForm(
  material: Material,
): RemoveStockFormValues {
  return {
    entries: material.locations.map((stock) => ({
      locationId: stock.locationId,
      quantity: '',
    })),
  }
}

// The caps are the locations' live quantities, so the schema is built per
// material — taking more than a location holds would drive it negative. The
// backend guards the same check, so this is the early, inline refusal.
export function removeStockSchema(available: Record<string, number>) {
  return z
    .object({
      entries: z
        .array(
          z.object({
            locationId: z.string(),
            // A blank string means "not entered yet" — mirrors NumberInput in
            // types/inventory-form.ts.
            quantity: z.union([z.number(), z.literal('')]),
          }),
        )
        .min(1, 'Add at least one location.'),
    })
    .superRefine((value, ctx) => {
      value.entries.forEach((entry, index) => {
        // Blank means "leave this location alone", not zero.
        if (entry.quantity === '') return

        if (entry.quantity <= 0) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter a quantity greater than 0.',
            path: ['entries', index, 'quantity'],
          })
          return
        }

        if (entry.quantity - (available[entry.locationId] ?? 0) > 1e-9) {
          ctx.addIssue({
            code: 'custom',
            message: 'More than this location holds.',
            path: ['entries', index, 'quantity'],
          })
        }
      })

      if (
        !value.entries.some(
          (entry) => entry.quantity !== '' && entry.quantity > 0,
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter at least one quantity to remove.',
          path: ['entries'],
        })
      }
    })
}
