import { createFileRoute } from '@tanstack/react-router'
import { OrderStagesPage } from '@/features/order-stages/order-stages'

export const Route = createFileRoute('/_authenticated/order-stages/')({
  staticData: { title: 'Order Stages' },
  component: OrderStagesPage,
})
