import type { DesignOption } from '@/features/design-options/types/design-option'

// The seven fixed order slots and the invoice form field each one writes.
// Shared by pricing, the invoice form's initial values, and the design pickers'
// default selection so a slot can't drift between them.
export const DESIGN_SLOTS = {
  thobeType: 'thob_type',
  fPocket: 'front_pocket',
  sPocket: 'side_pocket',
  collar: 'neck',
  sleeve: 'sleeve',
  patti: 'patti',
  emd: 'emd',
} as const

export type DesignSlotField = keyof typeof DESIGN_SLOTS
export type DesignDefaults = Partial<Record<DesignSlotField, string>>

/** The catalog's active defaults, keyed by the form field each one preselects. */
export function designDefaultsFromOptions(
  options: DesignOption[],
): DesignDefaults {
  const defaults: DesignDefaults = {}
  for (const [field, category] of Object.entries(DESIGN_SLOTS) as [
    DesignSlotField,
    string,
  ][]) {
    const option = options.find(
      (item) => item.category === category && item.isActive && item.isDefault,
    )
    if (option) defaults[field] = option.slug
  }
  return defaults
}
