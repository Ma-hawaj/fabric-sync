import * as React from 'react'

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

/**
 * One customer's orders, matched on the mobile number the customer sheet
 * already has. The filter is applied by the API rather than by fetching every
 * order and discarding most of them.
 */
export function useCustomerOrders(mobileNo: string | undefined) {
  const searchParams = React.useMemo(() => {
    const search = new URLSearchParams()
    if (!mobileNo) return search

    search.set(
      'filters',
      JSON.stringify([
        {
          id: 'customerMobile',
          value: mobileNo,
          variant: 'text',
          operator: 'eq',
        },
      ]),
    )
    return search
  }, [mobileNo])

  const query = useOrders(searchParams)

  return { ...query, data: mobileNo ? query.data : [] }
}
