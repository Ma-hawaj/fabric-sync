import { useListQuery } from '@/hooks/use-list-query'
import type { OrderStage } from '../types/order-stage'

const ENDPOINT = '/order-stages'
const QUERY_KEY = 'order-stages'
const ALL = new URLSearchParams()

/**
 * The whole stage catalog, unpaginated — the pages list every stage and the
 * form resolves its edit target by id, so no page of rows will do. An empty
 * request omits `perPage`, which is what tells the API not to page.
 */
export function useOrderStages() {
  return useListQuery<OrderStage>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams: ALL,
  })
}
