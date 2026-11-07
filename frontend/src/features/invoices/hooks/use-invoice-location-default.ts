import { useInfiniteListQuery } from '@/hooks/use-infinite-list-query'
import { usePreferences } from '@/features/locations/hooks/use-default-location'
import {
  ISSUING_BRANCH_FILTERS,
  ORDER_RECEIVING_FILTERS,
  PRODUCTION_FILTERS,
  STOCK_FILTERS,
  issuingLocations,
  orderReceivingLocations,
  productionLocations,
  stockLocations,
} from '@/features/locations/lib/location-filters'
import type { Location } from '@/features/locations/types/location'

const FILTERS = {
  issuing: ISSUING_BRANCH_FILTERS,
  receiving: ORDER_RECEIVING_FILTERS,
  production: PRODUCTION_FILTERS,
  stock: STOCK_FILTERS,
}

const LOCATION_RULES = {
  issuing: issuingLocations,
  receiving: orderReceivingLocations,
  production: productionLocations,
  stock: stockLocations,
}

/** Prefer the user's eligible default, then the only eligible location. */
export function useInvoiceLocationDefault(
  kind: keyof typeof FILTERS,
): Location | null {
  const preferences = usePreferences()
  const options = useInfiniteListQuery<Location>({
    endpoint: '/locations',
    queryKey: 'invoice-location-default',
    searchField: 'name',
    filters: FILTERS[kind],
    perPage: 2,
  })
  const preferred = preferences.data?.defaultLocation
  if (preferred && LOCATION_RULES[kind]([preferred]).length > 0) {
    return preferred
  }
  // Wait for preferences so a fast options request cannot win the race.
  if (preferences.isPending || options.isError) return null
  const firstPage = options.data?.pages[0]
  return firstPage?.total === 1 ? (firstPage.data[0] ?? null) : null
}
