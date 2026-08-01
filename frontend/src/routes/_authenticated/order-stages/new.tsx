import { createFileRoute } from '@tanstack/react-router'
import { OrderStageFormPage } from '@/features/order-stages/order-stage-form'

export const Route = createFileRoute('/_authenticated/order-stages/new')({
  staticData: { title: 'Add Stage' },
  component: OrderStageFormPage,
})
