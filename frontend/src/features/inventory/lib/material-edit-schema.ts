import { z } from 'zod'
import { moneyInputSchema } from '@/lib/money'
import type { Material } from '../types/inventory'

export const materialEditSchema = z.object({
  name: z.string().trim().min(1, 'Enter a material name.'),
  sku: z.string(),
  family: z.string(),
  unit: z.string().trim().min(1, 'Pick a unit.'),
  juniorPrice: moneyInputSchema,
  normalPrice: moneyInputSchema,
  largePrice: moneyInputSchema,
})

export function materialEditValues(material: Material) {
  return {
    name: material.name,
    sku: material.sku ?? '',
    family: material.family ?? '',
    unit: material.unit,
    juniorPrice: material.juniorPrice ?? ('' as const),
    normalPrice: material.normalPrice ?? ('' as const),
    largePrice: material.largePrice ?? ('' as const),
  }
}
export type MaterialEditValues = ReturnType<typeof materialEditValues>
