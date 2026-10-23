import { isMoney } from '@/lib/money'
import type { DesignOption } from '@/features/design-options/types/design-option'
import type { InvoiceOrderDraft } from '../types/invoice-form'
import type { Material } from '../types/materials'

// Shared ranges for every material. Keep in sync with the two constants in
// backend/src/features/pricing/service.rs. Boundaries belong to normal.
export const JUNIOR_BELOW_METRES = 3
export const LARGE_ABOVE_METRES = 4

export type PricingTier = 'junior' | 'normal' | 'large'

export function pricingTier(quantity: number): PricingTier {
  return quantity < JUNIOR_BELOW_METRES
    ? 'junior'
    : quantity > LARGE_ABOVE_METRES
      ? 'large'
      : 'normal'
}

const DESIGN_SLOTS = {
  thobeType: 'thob_type',
  fPocket: 'front_pocket',
  sPocket: 'side_pocket',
  collar: 'neck',
  sleeve: 'sleeve',
  patti: 'patti',
  emd: 'emd',
} as const

export interface GarmentPrice {
  tier: PricingTier | null
  base: number
  designCost: number
  total: number
}

// Null means pricing is incomplete: never silently treat a missing price or
// an unknown selected design as free.
export function calculateGarmentPrice(
  order: InvoiceOrderDraft,
  material: Material | null,
  options: DesignOption[],
): GarmentPrice | null {
  if (
    order.materialAmount === '' ||
    !isMoney(order.materialAmount) ||
    order.materialAmount < 0.01
  )
    return null
  const tier =
    order.materialSource === 'shop' ? pricingTier(order.materialAmount) : null
  const base = tier
    ? material?.id === order.materialId
      ? material[`${tier}Price`]
      : null
    : order.customerBasePrice
  if (!isMoney(base)) return null
  let designCost = 0
  for (const [field, category] of Object.entries(DESIGN_SLOTS)) {
    const slug = order[field as keyof typeof DESIGN_SLOTS]
    if (!slug) continue
    const option = options.find(
      (item) => item.category === category && item.slug === slug,
    )
    if (!option || !isMoney(option.cost)) return null
    designCost += option.cost
  }
  designCost = Math.round(designCost * 100) / 100
  const total = Math.round((base + designCost) * 100) / 100
  return isMoney(total) ? { tier, base, designCost, total } : null
}
