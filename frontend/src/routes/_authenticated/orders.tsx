import { createFileRoute } from '@tanstack/react-router'
import { OrdersPage } from '@/features/orders/orders'

export const Route = createFileRoute('/_authenticated/orders')({
  staticData: { title: 'Orders' },
  component: OrdersPage,
})
