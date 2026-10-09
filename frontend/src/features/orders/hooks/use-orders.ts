import { useListQuery } from '@/hooks/use-list-query'
import type { Order } from '../types/orders'

const ENDPOINT = '/orders'
const QUERY_KEY = 'orders'

type OrderResponse = Omit<Order, 'invoiceDate'> & { invoiceDate: string }

// The date filter and the invoice-date column both work on a real `Date`.
const toOrder = (order: OrderResponse): Order => ({
  ...order,
  invoiceDate: new Date(order.invoiceDate),
})

export function useOrders(searchParams: URLSearchParams) {
  return useListQuery<OrderResponse, Order>({
    endpoint: ENDPOINT,
    queryKey: QUERY_KEY,
    searchParams,
    select: toOrder,
  })
}
