import type { AudienceFilter } from '../types'

export interface AudienceFormValues {
  lastPurchaseFrom: string
  lastPurchaseTo: string
  neverPurchased: boolean
  minPurchases: string
  maxPurchases: string
  minSpend: string
  maxSpend: string
  branchId: string
}

function purchaseCount(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const count = Number(trimmed)
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(count))
    throw new Error('Enter whole, non-negative purchase counts.')
  return count
}

export function audienceFromForm(
  values: AudienceFormValues,
  excludedCustomerIds: string[] = [],
): AudienceFilter {
  return {
    lastPurchaseFrom: values.lastPurchaseFrom || null,
    lastPurchaseTo: values.lastPurchaseTo || null,
    neverPurchased: values.neverPurchased,
    minPurchases: purchaseCount(values.minPurchases),
    maxPurchases: purchaseCount(values.maxPurchases),
    minSpend: values.minSpend.trim() || null,
    maxSpend: values.maxSpend.trim() || null,
    branchId: values.branchId || null,
    excludedCustomerIds,
  }
}
