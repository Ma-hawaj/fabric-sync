import type { DesignCategory, DesignOption } from './design-option'

export interface DesignOptionFormValues {
  category: DesignCategory | ''
  /** The stored identity. Set once on create, read-only afterwards. */
  slug: string
  label: string
  cost: number | ''
  sortOrder: number | ''
  isActive: boolean
  /** Data URL preview of the illustration. `null` means none. */
  imageDataUrl: string | null
}

export function createEmptyDesignOptionForm(): DesignOptionFormValues {
  return {
    category: 'thob_type',
    slug: '',
    label: '',
    cost: 0,
    sortOrder: '',
    isActive: true,
    imageDataUrl: null,
  }
}

export function designOptionToFormValues(
  option: DesignOption,
  imageDataUrl: string | null,
): DesignOptionFormValues {
  return {
    category: option.category as DesignCategory,
    slug: option.slug,
    label: option.label,
    cost: option.cost,
    sortOrder: option.sortOrder,
    isActive: option.isActive,
    imageDataUrl,
  }
}
