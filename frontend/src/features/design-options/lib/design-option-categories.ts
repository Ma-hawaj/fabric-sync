import type { DesignCategory } from '../types/design-option'

export interface DesignCategoryMeta {
  key: DesignCategory
  label: string
}

// The fixed order design slots, in the order they render on the invoice and
// order documents. New slots are a schema change, not a row — only the
// options inside these are dynamic.
export const DESIGN_CATEGORIES: readonly DesignCategoryMeta[] = [
  { key: 'thob_type', label: 'Thobe Type' },
  { key: 'front_pocket', label: 'Front Pocket' },
  { key: 'side_pocket', label: 'Side Pocket' },
  { key: 'neck', label: 'Collar' },
  { key: 'sleeve', label: 'Sleeve' },
  { key: 'patti', label: 'Patti' },
  { key: 'emd', label: 'EMD' },
] as const

export function designCategoryLabel(category: string): string {
  return (
    DESIGN_CATEGORIES.find((meta) => meta.key === category)?.label ?? category
  )
}
