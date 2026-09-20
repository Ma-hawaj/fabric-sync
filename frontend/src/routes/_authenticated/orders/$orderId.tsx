import { createFileRoute } from '@tanstack/react-router'
import { OrderDetailPage } from '@/features/orders/order-detail'

export const Route = createFileRoute('/_authenticated/orders/$orderId')({
  staticData: { title: 'Order Details' },
  component: OrderDetailRoute,
})

function OrderDetailRoute() {
  const { orderId } = Route.useParams()
  return <OrderDetailPage orderId={orderId} />
}
